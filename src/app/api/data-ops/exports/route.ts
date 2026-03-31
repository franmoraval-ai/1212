import { NextResponse } from "next/server"
import { getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"
import {
  buildExportPayload,
  fetchDataOpsRows,
  getExportLimitHelp,
  isDataOpsEntity,
  normalizeDataOpsFilters,
  type DataExportFormat,
  type DataOpsSource,
} from "@/lib/data-ops"

function canManageDataOps(actor: Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]) {
  return isDirector(actor) || hasCustomPermission(actor, "data_ops_manage")
}

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para operar centro de datos." }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      entityType?: string
      source?: DataOpsSource
      format?: DataExportFormat
      filters?: unknown
    }

    const entityType = String(body.entityType ?? "").trim()
    if (!isDataOpsEntity(entityType)) {
      return NextResponse.json({ error: "entityType invalido." }, { status: 400 })
    }

    const source = body.source === "archive" ? "archive" : "live"
    const format = body.format === "json" ? "json" : "csv"
    const filters = normalizeDataOpsFilters(body.filters)
    const limitInfo = getExportLimitHelp()

    const { data: job, error: jobInsertError } = await admin
      .from("data_export_jobs")
      .insert({
        requested_by_uid: actor.uid,
        requested_by_email: actor.email,
        entity_type: entityType,
        data_source: source,
        export_format: format,
        filters,
        status: "processing",
      })
      .select("id")
      .single()

    if (jobInsertError || !job?.id) {
      return NextResponse.json({ error: jobInsertError?.message ?? "No se pudo crear job de exportacion." }, { status: 500 })
    }

    try {
      const rows = await fetchDataOpsRows(admin, entityType, source, filters)
      const payload = buildExportPayload(entityType, source, format, rows)

      const { error: updateError } = await admin
        .from("data_export_jobs")
        .update({
          status: "completed",
          row_count: payload.rowCount,
          file_name: payload.filename,
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", job.id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({
        ok: true,
        jobId: job.id,
        rowCount: payload.rowCount,
        filename: payload.filename,
        limit: limitInfo.max,
      })
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "No se pudo generar la exportacion."

      await admin
        .from("data_export_jobs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id)

      return NextResponse.json({ error: message }, { status: 500 })
    }
  } catch {
    return NextResponse.json({ error: "Error inesperado creando exportacion." }, { status: 500 })
  }
}
