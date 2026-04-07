import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { ROUND_REPORT_CONTEXT_SELECT_EXTENDED, ROUND_REPORT_CONTEXT_SELECT_STABLE } from "@/lib/supervision-selects"

function camelizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = value
  }
  return out
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const url = new URL(request.url)
  const includeReports = url.searchParams.get("includeReports") === "1"
  const includeSecurityConfig = url.searchParams.get("includeSecurityConfig") === "1"
  const includeSessions = url.searchParams.get("includeSessions") === "1"
  const includeRounds = url.searchParams.get("includeRounds") !== "0"
  const includeAuthorizedOperations = url.searchParams.get("includeAuthorizedOperations") !== "0"

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const jobs: Array<PromiseLike<{ key: string; data: unknown[] | null; error: { message?: string } | null }>> = []

    if (includeRounds) {
      jobs.push(
        client
          .from("rounds")
          .select("id,name,post,status,frequency,instructions,checkpoints")
          .order("name", { ascending: true })
          .then(({ data, error: queryError }) => ({ key: "rounds", data, error: queryError }))
      )
    }

    if (includeReports) {
      jobs.push(
        client
          .from("round_reports")
          .select(ROUND_REPORT_CONTEXT_SELECT_EXTENDED)
          .order("created_at", { ascending: false })
          .then(({ data, error: queryError }) => ({ key: "reports", data, error: queryError }))
      )
    }

    if (includeSecurityConfig) {
      jobs.push(
        client
          .from("round_security_config")
          .select("id,geofence_radius_meters,no_scan_gap_minutes,max_jump_meters,updated_by,updated_at")
          .order("updated_at", { ascending: false })
          .limit(1)
          .then(({ data, error: queryError }) => ({ key: "securityConfigRows", data, error: queryError }))
      )
    }

    if (includeSessions) {
      jobs.push(
        client
          .from("round_sessions")
          .select("id,round_id,round_name,post_name,officer_id,officer_name,supervisor_id,status,started_at,ended_at,expected_end_at,checkpoints_total,checkpoints_completed,last_scan_at,updated_at")
          .eq("status", "in_progress")
          .order("started_at", { ascending: false })
          .limit(40)
          .then(({ data, error: queryError }) => ({ key: "roundSessions", data, error: queryError }))
      )
    }

    // For non-L4 users, fetch authorized operations from station_officer_authorizations + operation_catalog
    if (includeAuthorizedOperations && !isDirector(actor)) {
      jobs.push(
        client
          .from("station_officer_authorizations")
          .select("operation_catalog_id,is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(operation_name,client_name)")
          .eq("officer_user_id", actor.userId)
          .eq("is_active", true)
          .then(({ data, error: queryError }) => ({ key: "authorizedOperations", data, error: queryError }))
      )
    }

    const results = await Promise.all(jobs)
    const resultMap = new Map(results.map((item) => [item.key, item]))

    const roundsResult = resultMap.get("rounds")
    if (includeRounds && (!roundsResult || roundsResult.error)) {
      return NextResponse.json({ error: roundsResult?.error?.message ?? "No se pudieron cargar las rondas." }, { status: 500 })
    }

    const reportsResult = resultMap.get("reports")
    let reportsData = reportsResult?.data ?? null
    let reportsError = reportsResult?.error ?? null
    if (reportsError) {
      const fallback = await client
        .from("round_reports")
        .select(ROUND_REPORT_CONTEXT_SELECT_STABLE)
        .order("created_at", { ascending: false })
      reportsData = fallback.data
      reportsError = fallback.error
    }

    if (reportsError) {
      return NextResponse.json({ error: reportsError.message ?? "No se pudieron cargar las boletas de ronda." }, { status: 500 })
    }

    const securityConfigResult = resultMap.get("securityConfigRows")
    if (securityConfigResult?.error) {
      return NextResponse.json({ error: securityConfigResult.error.message ?? "No se pudo cargar la configuración de rondas." }, { status: 500 })
    }

    const roundSessionsResult = resultMap.get("roundSessions")
    if (roundSessionsResult?.error) {
      return NextResponse.json({ error: roundSessionsResult.error.message ?? "No se pudieron cargar las rondas activas." }, { status: 500 })
    }

    // Process authorized operations: filter active time windows, flatten catalog join
    const authorizedOpsResult = resultMap.get("authorizedOperations")
    const now = Date.now()
    let authorizedOperations: { operationName: string; clientName: string }[] = []

    if (includeAuthorizedOperations && authorizedOpsResult?.error) {
      // station_officer_authorizations query failed (table missing or join error)
      // Fall back to parsing actor.assigned field
      const raw = String(actor.assigned ?? "").trim()
      if (raw) {
        const tokens = raw.split(/[|,;]+/).map((t) => t.trim()).filter(Boolean)
        if (tokens.length >= 2) {
          authorizedOperations = [{ operationName: tokens[0], clientName: tokens[1] }]
        } else if (tokens.length === 1) {
          authorizedOperations = [{ operationName: tokens[0], clientName: "" }]
        }
      }
    } else if (includeAuthorizedOperations && Array.isArray(authorizedOpsResult?.data)) {
      authorizedOperations = (authorizedOpsResult.data as Record<string, unknown>[])
        .filter((row) => {
          const validFrom = row.valid_from ? new Date(row.valid_from as string).getTime() : null
          const validTo = row.valid_to ? new Date(row.valid_to as string).getTime() : null
          if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
          if (validTo && Number.isFinite(validTo) && validTo < now) return false
          return true
        })
        .map((row) => {
          const catalog = (row.operation_catalog ?? {}) as Record<string, unknown>
          return { operationName: String(catalog.operation_name ?? ""), clientName: String(catalog.client_name ?? "") }
        })
        .filter((op) => op.operationName || op.clientName)
    }

    return NextResponse.json({
      rounds: Array.isArray(roundsResult?.data) ? roundsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      reports: Array.isArray(reportsData) ? reportsData.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      securityConfigRows: Array.isArray(securityConfigResult?.data) ? securityConfigResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      roundSessions: Array.isArray(roundSessionsResult?.data) ? roundSessionsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      authorizedOperations,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el contexto de rondas." },
      { status: 500 }
    )
  }
}
