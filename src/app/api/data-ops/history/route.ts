import { NextResponse } from "next/server"
import { fetchArchivedHistoryRows, isDataOpsEntity, normalizeDataOpsFilters } from "@/lib/data-ops"
import { getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"

function canManageDataOps(actor: Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]) {
  return isDirector(actor) || hasCustomPermission(actor, "data_ops_manage")
}

export async function GET(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para consultar historico." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const entityType = String(searchParams.get("entityType") ?? "").trim()
    if (!isDataOpsEntity(entityType)) {
      return NextResponse.json({ error: "entityType invalido." }, { status: 400 })
    }

    const filters = normalizeDataOpsFilters({
      dateFrom: searchParams.get("dateFrom"),
      dateTo: searchParams.get("dateTo"),
      search: searchParams.get("search"),
      status: searchParams.get("status"),
      operation: searchParams.get("operation"),
      post: searchParams.get("post"),
      officer: searchParams.get("officer"),
      supervisor: searchParams.get("supervisor"),
      limit: searchParams.get("limit"),
    })

    const rows = await fetchArchivedHistoryRows(admin, entityType, filters)
    return NextResponse.json({ ok: true, rows })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado consultando historico." }, { status: 500 })
  }
}