import { NextResponse } from "next/server"
import { canManageDataOps } from "@/lib/data-ops-archive"
import { getAuthenticatedActor } from "@/lib/server-auth"

function camelizeRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = value
  }
  return out
}

export async function GET(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para operar centro de datos." }, { status: 403 })
    }

    const [exportJobsResult, archiveRunsResult, restoreRunsResult] = await Promise.all([
      admin
        .from("data_export_jobs")
        .select("id,entity_type,data_source,export_format,status,row_count,file_name,error_message,created_at,completed_at")
        .order("created_at", { ascending: false }),
      admin
        .from("data_archive_runs")
        .select("id,entity_type,cutoff_date,dry_run,batch_size,status,matched_count,archived_count,deleted_count,error_message,created_at,completed_at")
        .order("created_at", { ascending: false }),
      admin
        .from("data_restore_runs")
        .select("id,source_run_id,entity_type,dry_run,batch_size,status,matched_count,restored_count,removed_from_archive_count,error_message,created_at,completed_at")
        .order("created_at", { ascending: false }),
    ])

    if (exportJobsResult.error) {
      return NextResponse.json({ error: exportJobsResult.error.message ?? "No se pudieron cargar los jobs de exportación." }, { status: 500 })
    }

    if (archiveRunsResult.error) {
      return NextResponse.json({ error: archiveRunsResult.error.message ?? "No se pudieron cargar las corridas de archivado." }, { status: 500 })
    }

    if (restoreRunsResult.error) {
      return NextResponse.json({ error: restoreRunsResult.error.message ?? "No se pudieron cargar las corridas de restauración." }, { status: 500 })
    }

    return NextResponse.json({
      exportJobs: Array.isArray(exportJobsResult.data) ? exportJobsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      archiveRuns: Array.isArray(archiveRunsResult.data) ? archiveRunsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
      restoreRuns: Array.isArray(restoreRunsResult.data) ? restoreRunsResult.data.map((row) => camelizeRow(row as Record<string, unknown>)) : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el centro de datos." },
      { status: 500 }
    )
  }
}