import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import {
  ROUND_REPORT_CONTEXT_SELECT_EXTENDED,
  ROUND_REPORT_CONTEXT_SELECT_STABLE,
  ROUND_REPORT_GROUPED_SUMMARY_SELECT,
} from "@/lib/supervision-selects"

const DEFAULT_REPORTS_LIMIT = 120
const MAX_REPORTS_LIMIT = 1000
const REPORTS_FALLBACK_LIMIT = 200
const MAX_REPORT_IDS = 80
const ROUND_REPORT_MODE_VALUES = new Set(["summary", "full"])
const ROUND_REPORT_CONTEXT_SELECT_LEAN = [
  "id",
  "started_at",
  "ended_at",
  "round_id",
  "round_name",
  "post_name",
  "officer_id",
  "officer_name",
  "status",
  "notes",
  "checkpoints_total",
  "checkpoints_completed",
  "created_at",
].join(",")

let canUseRoundReportSupervisorColumns: boolean | null = null

type RoundReportMode = "summary" | "full"

function resolveReportsLimit(value: string | null) {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPORTS_LIMIT
  return Math.min(MAX_REPORTS_LIMIT, parsed)
}

function resolveRoundReportMode(value: string | null): RoundReportMode {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!ROUND_REPORT_MODE_VALUES.has(normalized)) return "summary"
  return normalized as RoundReportMode
}

function resolveRoundReportIds(url: URL) {
  const joined = [
    String(url.searchParams.get("reportId") ?? ""),
    String(url.searchParams.get("reportIds") ?? ""),
  ].join(",")

  const ids = joined
    .split(",")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)

  return Array.from(new Set(ids)).slice(0, MAX_REPORT_IDS)
}

function hasRoundReportSupervisorCompatColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("supervisor_name") || normalized.includes("supervisor_id")
}

type RoundReportFilterQuery<TQuery> = {
  eq: (column: string, value: string) => TQuery
  in: (column: string, values: string[]) => TQuery
}

function applyRoundReportIdFilter<TQuery extends RoundReportFilterQuery<TQuery>>(
  query: TQuery,
  reportIds: string[]
) {
  if (reportIds.length === 1) {
    return query.eq("id", reportIds[0])
  }
  if (reportIds.length > 1) {
    return query.in("id", reportIds)
  }
  return query
}

function camelizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = value
  }
  return out
}

async function loadRoundReportsWithFallback(
  client: ReturnType<typeof createRequestSupabaseClient>,
  reportsLimit: number,
  options: { mode: RoundReportMode; reportIds: string[] }
) {
  const warnings: string[] = []
  const { mode, reportIds } = options

  if (mode === "summary") {
    const summaryLimit = Math.max(reportsLimit, reportIds.length)
    const summaryQuery = applyRoundReportIdFilter(
      client
        .from("round_reports")
        .select(ROUND_REPORT_GROUPED_SUMMARY_SELECT)
        .order("created_at", { ascending: false }),
      reportIds
    )
    const summary = await summaryQuery.limit(summaryLimit)
    return {
      data: summary.data,
      error: summary.error,
      warnings,
    }
  }

  const fullLimit = Math.max(reportsLimit, reportIds.length)
  const shouldTryExtended = canUseRoundReportSupervisorColumns !== false

  if (shouldTryExtended) {
    const extendedQuery = applyRoundReportIdFilter(
      client
        .from("round_reports")
        .select(ROUND_REPORT_CONTEXT_SELECT_EXTENDED)
        .order("created_at", { ascending: false }),
      reportIds
    )
    const extended = await extendedQuery.limit(fullLimit)

    if (!extended.error) {
      canUseRoundReportSupervisorColumns = true
      return {
        data: extended.data,
        error: null,
        warnings,
      }
    }

    warnings.push(`reports_extended_fallback:${String(extended.error.message ?? "unknown")}`)

    if (hasRoundReportSupervisorCompatColumnError(extended.error.message)) {
      canUseRoundReportSupervisorColumns = false
      warnings.push("reports_extended_disabled_cached")
    }
  } else {
    warnings.push("reports_extended_skipped_cached")
  }

  const stableQuery = applyRoundReportIdFilter(
    client
      .from("round_reports")
      .select(ROUND_REPORT_CONTEXT_SELECT_STABLE)
      .order("created_at", { ascending: false }),
    reportIds
  )
  const stable = await stableQuery.limit(fullLimit)

  if (!stable.error) {
    return {
      data: stable.data,
      error: null,
      warnings,
    }
  }

  warnings.push(`reports_stable_fallback:${String(stable.error.message ?? "unknown")}`)

  const leanLimit = Math.max(Math.min(reportsLimit, REPORTS_FALLBACK_LIMIT), reportIds.length)
  const leanQuery = applyRoundReportIdFilter(
    client
      .from("round_reports")
      .select(ROUND_REPORT_CONTEXT_SELECT_LEAN)
      .order("created_at", { ascending: false }),
    reportIds
  )
  const lean = await leanQuery.limit(leanLimit)

  if (!lean.error) {
    warnings.push(`reports_lean_payload_limit:${String(leanLimit)}`)
    return {
      data: lean.data,
      error: null,
      warnings,
    }
  }

  warnings.push(`reports_lean_failed:${String(lean.error.message ?? "unknown")}`)

  return {
    data: lean.data,
    error: lean.error,
    warnings,
  }
}

export async function GET(request: Request) {
  const requestStartedAt = Date.now()
  const timings: Record<string, number> = {}

  const measure = <T,>(label: string, startedAt: number, value: T): T => {
    timings[label] = Date.now() - startedAt
    return value
  }

  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const url = new URL(request.url)
  const includeReports = url.searchParams.get("includeReports") === "1"
  const includeSecurityConfig = url.searchParams.get("includeSecurityConfig") === "1"
  const includeSessions = url.searchParams.get("includeSessions") === "1"
  const includeRounds = url.searchParams.get("includeRounds") !== "0"
  const includeAuthorizedOperations = url.searchParams.get("includeAuthorizedOperations") !== "0"
  const reportsLimit = resolveReportsLimit(url.searchParams.get("reportsLimit"))
  const roundReportMode = resolveRoundReportMode(url.searchParams.get("reportMode"))
  const roundReportIds = resolveRoundReportIds(url)

  try {
    const warnings: string[] = []
    let actor: Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"] = null

    if (includeAuthorizedOperations) {
      const authStartedAt = Date.now()
      const authResult = await getAuthenticatedActor(request)
      measure("actorAuthMs", authStartedAt, null)
      actor = authResult.actor
      if (!actor) {
        return NextResponse.json({ error: authResult.error ?? "No autenticado." }, { status: authResult.status })
      }
    }

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
    if (includeAuthorizedOperations && actor && !isDirector(actor)) {
      jobs.push(
        client
          .from("station_officer_authorizations")
          .select("operation_catalog_id,is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(operation_name,client_name)")
          .eq("officer_user_id", actor.userId)
          .eq("is_active", true)
          .then(({ data, error: queryError }) => ({ key: "authorizedOperations", data, error: queryError }))
      )
    }

    const jobsStartedAt = Date.now()
    const results = await Promise.all(jobs)
    measure("parallelJobsMs", jobsStartedAt, null)
    const resultMap = new Map(results.map((item) => [item.key, item]))

    const roundsResult = resultMap.get("rounds")
    if (includeRounds && (!roundsResult || roundsResult.error)) {
      return NextResponse.json({ error: roundsResult?.error?.message ?? "No se pudieron cargar las rondas." }, { status: 500 })
    }

    let reportsData: unknown[] | null = []
    if (includeReports) {
      const reportsStartedAt = Date.now()
      const reportsResult = await loadRoundReportsWithFallback(client, reportsLimit, {
        mode: roundReportMode,
        reportIds: roundReportIds,
      })
      reportsData = reportsResult.data
      warnings.push(...reportsResult.warnings)
      measure("reportsFetchMs", reportsStartedAt, null)
      if ((timings.reportsFetchMs ?? 0) >= 2500) {
        warnings.push(`reports_fetch_slow_ms:${String(timings.reportsFetchMs)}`)
      }

      if (reportsResult.error) {
        return NextResponse.json({ error: reportsResult.error.message ?? "No se pudieron cargar las boletas de ronda." }, { status: 500 })
      }
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
    const authOpsStartedAt = Date.now()

    if (includeAuthorizedOperations && authorizedOpsResult?.error) {
      // station_officer_authorizations query failed (table missing or join error)
      // Fall back to parsing actor.assigned field
      warnings.push(`authorized_operations_fallback:${String(authorizedOpsResult.error.message ?? "unknown")}`)
      const raw = String(actor?.assigned ?? "").trim()
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

      measure("authorizedOperationsMs", authOpsStartedAt, null)
      timings.totalMs = Date.now() - requestStartedAt

    return NextResponse.json({
      rounds: Array.isArray(roundsResult?.data) ? roundsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      reports: Array.isArray(reportsData) ? reportsData.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      securityConfigRows: Array.isArray(securityConfigResult?.data) ? securityConfigResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      roundSessions: Array.isArray(roundSessionsResult?.data) ? roundSessionsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      authorizedOperations,
      warnings,
      timings,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el contexto de rondas." },
      { status: 500 }
    )
  }
}
