import { NextResponse } from "next/server"
import { createEmptyManagedTeamScope, loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { canViewSupervisionRecord, loadActorSupervisionScopes } from "@/lib/supervision-visibility"
import {
  SUPERVISION_DETAIL_SELECT_EXTENDED,
  SUPERVISION_DETAIL_SELECT_STABLE,
  SUPERVISION_LIST_SUMMARY_SELECT,
  SUPERVISION_LIST_SUMMARY_SELECT_STABLE,
} from "@/lib/supervision-selects"

const DEFAULT_REPORTS_LIMIT = 300
const MAX_REPORTS_LIMIT = 1000

function resolveReportsLimit(value: string | null) {
  const raw = String(value ?? "").trim()
  if (!raw) return DEFAULT_REPORTS_LIMIT

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPORTS_LIMIT
  return Math.min(parsed, MAX_REPORTS_LIMIT)
}

function camelizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = value
  }
  return out
}

function normalizeOperationCatalog(row: Record<string, unknown>) {
  return {
    id: String(row.id ?? ""),
    operationName: String(row.operation_name ?? ""),
    clientName: String(row.client_name ?? ""),
    isActive: row.is_active !== false,
  }
}

function normalizeWeapon(row: Record<string, unknown>) {
  return {
    model: String(row.model ?? ""),
    serial: String(row.serial ?? ""),
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

  const { actor, admin, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const url = new URL(request.url)
    const id = String(url.searchParams.get("id") ?? "").trim()
    const ids = Array.from(new Set(String(url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)))
    const includeReports = url.searchParams.get("includeReports") !== "0"
    const includeOperationCatalog = url.searchParams.get("includeOperationCatalog") !== "0"
    const includeWeaponsCatalog = url.searchParams.get("includeWeaponsCatalog") !== "0"
    const reportsLimit = resolveReportsLimit(url.searchParams.get("reportsLimit"))
    const client = createRequestSupabaseClient(bearerToken)
    const reportsClient = isDirector(actor) ? admin : client
    const needsVisibilityScope = includeReports || Boolean(id) || ids.length > 0
    let actorScopes: string[] = []
    let managedTeamScope = createEmptyManagedTeamScope()

    if (needsVisibilityScope) {
      const scopeStartedAt = Date.now()
      actorScopes = await loadActorSupervisionScopes(admin, { userId: actor.userId, assigned: actor.assigned })
      const managedTeamResult = await loadManagedTeamScope(admin, actor)
      measure("scopeLoadMs", scopeStartedAt, null)
      if (managedTeamResult.error) {
        return NextResponse.json({ error: managedTeamResult.error }, { status: 500 })
      }
      managedTeamScope = managedTeamResult.scope
    }

    const runDetailQuery = (selectClause: string, targetIds: string[]) => {
      if (targetIds.length === 1) {
        return reportsClient
          .from("supervisions")
          .select(selectClause)
          .eq("id", targetIds[0])
      }

      return reportsClient
        .from("supervisions")
        .select(selectClause)
        .in("id", targetIds)
    }
    const runReportsQuery = (selectClause: string) => {
      let query = reportsClient
        .from("supervisions")
        .select(selectClause)
        .order("created_at", { ascending: false })

      if (reportsLimit) {
        query = query.limit(reportsLimit)
      }

      return query
    }

    if (id) {
      const detailStartedAt = Date.now()
      let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, [id]).maybeSingle()

      if (detailError) {
        const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, [id]).maybeSingle()
        data = fallback.data
        detailError = fallback.error
      }

      if (detailError) {
        return NextResponse.json({ error: detailError.message ?? "No se pudo cargar el detalle de la supervision." }, { status: 500 })
      }

      if (data && !canViewSupervisionRecord(actor, managedTeamScope, data as unknown as Record<string, unknown>, actorScopes)) {
        return NextResponse.json({ error: "La supervision está fuera de su dominio autorizado." }, { status: 403 })
      }

      measure("detailQueryMs", detailStartedAt, null)
      timings.totalMs = Date.now() - requestStartedAt

      return NextResponse.json({
        record: data ? camelizeRow(data as unknown as Record<string, unknown>) : null,
        timings,
      })
    }

    if (ids.length > 0) {
      const batchDetailStartedAt = Date.now()
      let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, ids)

      if (detailError) {
        const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, ids)
        data = fallback.data
        detailError = fallback.error
      }

      if (detailError) {
        return NextResponse.json({ error: detailError.message ?? "No se pudo cargar el detalle de supervisiones." }, { status: 500 })
      }

      const visibleRecords = Array.isArray(data)
        ? data.filter((row) => canViewSupervisionRecord(actor, managedTeamScope, row as unknown as Record<string, unknown>, actorScopes))
        : []

      measure("batchDetailQueryMs", batchDetailStartedAt, null)
      timings.totalMs = Date.now() - requestStartedAt

      return NextResponse.json({
        records: visibleRecords.map((row) => camelizeRow(row as unknown as Record<string, unknown>)),
        timings,
      })
    }

    const jobs: Array<PromiseLike<{ key: "operations" | "weapons" | "reports"; data: unknown; error: { message?: string } | null }>> = []
    if (includeOperationCatalog) {
      jobs.push(
        client
          .from("operation_catalog")
          .select("id,operation_name,client_name,is_active")
          .order("operation_name", { ascending: true })
          .then(({ data, error: queryError }) => ({ key: "operations" as const, data, error: queryError }))
      )
    }
    if (includeWeaponsCatalog) {
      jobs.push(
        client
          .from("weapons")
          .select("model,serial")
          .order("model", { ascending: true })
          .then(({ data, error: queryError }) => ({ key: "weapons" as const, data, error: queryError }))
      )
    }
    if (includeReports) {
      jobs.push(
        runReportsQuery(SUPERVISION_LIST_SUMMARY_SELECT)
          .then(({ data, error: queryError }) => ({ key: "reports" as const, data, error: queryError }))
      )
    }

    const listJobsStartedAt = Date.now()
    const results = await Promise.all(jobs)
    measure("listParallelJobsMs", listJobsStartedAt, null)
    const resultMap = new Map(results.map((item) => [item.key, item]))
    const operationsResult = resultMap.get("operations")
    const weaponsResult = resultMap.get("weapons")
    const reportsResult = resultMap.get("reports")

    let reportsData = reportsResult?.data
    let reportsError = reportsResult?.error ?? null
    if (includeReports && reportsError) {
      const fallback = await runReportsQuery(SUPERVISION_LIST_SUMMARY_SELECT_STABLE)
      reportsData = fallback.data
      reportsError = fallback.error
    }

    if (includeReports) {
      const rows = Array.isArray(reportsData) ? reportsData.length : 0
      timings.reportsRows = rows
    }

    if (operationsResult?.error) {
      return NextResponse.json({ error: operationsResult.error.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    if (weaponsResult?.error) {
      return NextResponse.json({ error: weaponsResult.error.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    if (includeReports && reportsError) {
      return NextResponse.json({ error: reportsError.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    const visibleReports = Array.isArray(reportsData)
      ? reportsData.filter((row) => canViewSupervisionRecord(actor, managedTeamScope, row as unknown as Record<string, unknown>, actorScopes))
      : []

    timings.visibleReportsRows = visibleReports.length
    timings.totalMs = Date.now() - requestStartedAt

    return NextResponse.json({
      reports: visibleReports.map((row) => camelizeRow(row as unknown as Record<string, unknown>)),
      operationCatalog: Array.isArray(operationsResult?.data) ? operationsResult.data.map((row) => normalizeOperationCatalog(row as unknown as Record<string, unknown>)) : [],
      weaponsCatalog: Array.isArray(weaponsResult?.data) ? weaponsResult.data.map((row) => normalizeWeapon(row as unknown as Record<string, unknown>)) : [],
      timings,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar supervisión." },
      { status: 500 }
    )
  }
}
