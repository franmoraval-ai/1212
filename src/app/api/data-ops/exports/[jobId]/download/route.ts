import { NextResponse } from "next/server"
import { buildExportPayload, fetchDataOpsRows, isDataOpsEntity, normalizeDataOpsFilters, type DataExportFormat, type DataOpsSource } from "@/lib/data-ops"
import { getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"

function canManageDataOps(actor: Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]) {
  return isDirector(actor) || hasCustomPermission(actor, "data_ops_manage")
}

export async function GET(request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para descargar desde centro de datos." }, { status: 403 })
    }

    const { jobId } = await context.params
    if (!jobId) {
      return NextResponse.json({ error: "jobId es obligatorio." }, { status: 400 })
    }

    const { data: job, error: jobError } = await admin
      .from("data_export_jobs")
      .select("id, requested_by_uid, entity_type, data_source, export_format, filters, status")
      .eq("id", jobId)
      .maybeSingle()

    if (jobError) {
      return NextResponse.json({ error: jobError.message }, { status: 500 })
    }

    if (!job) {
      return NextResponse.json({ error: "Job no encontrado." }, { status: 404 })
    }

    if (!canManageDataOps(actor) && String(job.requested_by_uid ?? "") !== actor.uid) {
      return NextResponse.json({ error: "No autorizado para este job." }, { status: 403 })
    }

    const entityType = String(job.entity_type ?? "").trim()
    if (!isDataOpsEntity(entityType)) {
      return NextResponse.json({ error: "Job con entity_type invalido." }, { status: 400 })
    }

    const source = job.data_source === "archive" ? "archive" : "live"
    const format = job.export_format === "json" ? "json" : "csv"
    const filters = normalizeDataOpsFilters(job.filters)
    const rows = await fetchDataOpsRows(admin, entityType, source as DataOpsSource, filters)
    const payload = buildExportPayload(entityType, source as DataOpsSource, format as DataExportFormat, rows)

    return new NextResponse(payload.content, {
      status: 200,
      headers: {
        "Content-Type": payload.mimeType,
        "Content-Disposition": `attachment; filename="${payload.filename}"`,
      },
    })
  } catch {
    return NextResponse.json({ error: "Error inesperado descargando exportacion." }, { status: 500 })
  }
}
