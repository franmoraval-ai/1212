import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import {
  SUPERVISION_DETAIL_SELECT_EXTENDED,
  SUPERVISION_DETAIL_SELECT_STABLE,
  SUPERVISION_LIST_SUMMARY_SELECT,
  SUPERVISION_LIST_SUMMARY_SELECT_STABLE,
} from "@/lib/supervision-selects"

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
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, admin, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const url = new URL(request.url)
    const id = String(url.searchParams.get("id") ?? "").trim()
    const ids = Array.from(new Set(String(url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)))
    const client = createRequestSupabaseClient(bearerToken)
    const reportsClient = isDirector(actor) && admin ? admin : client
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
    const runReportsQuery = (selectClause: string) => reportsClient
      .from("supervisions")
      .select(selectClause)
      .order("created_at", { ascending: false })

    if (id) {
      let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, [id]).maybeSingle()

      if (detailError) {
        const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, [id]).maybeSingle()
        data = fallback.data
        detailError = fallback.error
      }

      if (detailError) {
        return NextResponse.json({ error: detailError.message ?? "No se pudo cargar el detalle de la supervision." }, { status: 500 })
      }

      return NextResponse.json({
        record: data ? camelizeRow(data as unknown as Record<string, unknown>) : null,
      })
    }

    if (ids.length > 0) {
      let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, ids)

      if (detailError) {
        const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, ids)
        data = fallback.data
        detailError = fallback.error
      }

      if (detailError) {
        return NextResponse.json({ error: detailError.message ?? "No se pudo cargar el detalle de supervisiones." }, { status: 500 })
      }

      return NextResponse.json({
        records: Array.isArray(data) ? data.map((row) => camelizeRow(row as unknown as Record<string, unknown>)) : [],
      })
    }

    const [operationsResult, weaponsResult, reportsResult] = await Promise.all([
      client
        .from("operation_catalog")
        .select("id,operation_name,client_name,is_active")
        .order("operation_name", { ascending: true }),
      client
        .from("weapons")
        .select("model,serial")
        .order("model", { ascending: true }),
      runReportsQuery(SUPERVISION_LIST_SUMMARY_SELECT),
    ])

    let reportsData = reportsResult.data
    let reportsError = reportsResult.error
    if (reportsError) {
      const fallback = await runReportsQuery(SUPERVISION_LIST_SUMMARY_SELECT_STABLE)
      reportsData = fallback.data
      reportsError = fallback.error
    }

    if (operationsResult.error) {
      return NextResponse.json({ error: operationsResult.error.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    if (weaponsResult.error) {
      return NextResponse.json({ error: weaponsResult.error.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    if (reportsError) {
      return NextResponse.json({ error: reportsError.message ?? "No se pudo cargar supervisión." }, { status: 500 })
    }

    return NextResponse.json({
      reports: Array.isArray(reportsData) ? reportsData.map((row) => camelizeRow(row as unknown as Record<string, unknown>)) : [],
      operationCatalog: Array.isArray(operationsResult.data) ? operationsResult.data.map((row) => normalizeOperationCatalog(row as unknown as Record<string, unknown>)) : [],
      weaponsCatalog: Array.isArray(weaponsResult.data) ? weaponsResult.data.map((row) => normalizeWeapon(row as unknown as Record<string, unknown>)) : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar supervisión." },
      { status: 500 }
    )
  }
}