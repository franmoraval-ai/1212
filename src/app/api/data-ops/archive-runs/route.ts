import { NextResponse } from "next/server"
import { isDataOpsEntity } from "@/lib/data-ops"
import { canManageDataOps, executeArchiveRun } from "@/lib/data-ops-archive"
import { getAuthenticatedActor } from "@/lib/server-auth"

export async function GET(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para consultar archivados." }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 20), 1), 100)
    const { data, error: runsError } = await admin
      .from("data_archive_runs")
      .select("id, entity_type, cutoff_date, dry_run, status, matched_count, archived_count, deleted_count, batch_size, created_at, completed_at, error_message")
      .order("created_at", { ascending: false })
      .limit(limit)

    if (runsError) {
      return NextResponse.json({ error: runsError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, runs: data ?? [] })
  } catch {
    return NextResponse.json({ error: "Error inesperado consultando archivados." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para ejecutar archivado." }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as {
      entityType?: string
      cutoffDate?: string
      dryRun?: boolean
      batchSize?: number
    }

    const entityType = String(body.entityType ?? "").trim()
    if (!isDataOpsEntity(entityType)) {
      return NextResponse.json({ error: "entityType invalido." }, { status: 400 })
    }

    const cutoffDate = String(body.cutoffDate ?? "").trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoffDate)) {
      return NextResponse.json({ error: "cutoffDate debe tener formato YYYY-MM-DD." }, { status: 400 })
    }

    try {
      const result = await executeArchiveRun(admin, actor, {
        entityType,
        cutoffDate,
        dryRun: Boolean(body.dryRun),
        batchSize: Number(body.batchSize ?? 500),
      })

      return NextResponse.json({ ok: true, ...result })
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "No se pudo completar el archivado."
      return NextResponse.json({ error: message }, { status: 500 })
    }
  } catch {
    return NextResponse.json({ error: "Error inesperado ejecutando archivado." }, { status: 500 })
  }
}

