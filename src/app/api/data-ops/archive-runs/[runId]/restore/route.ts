import { NextResponse } from "next/server"
import { canManageDataOps, executeRestoreRun } from "@/lib/data-ops-archive"
import { getAuthenticatedActor } from "@/lib/server-auth"

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!canManageDataOps(actor)) {
      return NextResponse.json({ error: "Sin permiso para restaurar archivo." }, { status: 403 })
    }

    const { runId } = await context.params
    if (!runId) {
      return NextResponse.json({ error: "runId es obligatorio." }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { dryRun?: boolean; batchSize?: number }
    const result = await executeRestoreRun(admin, actor, {
      runId,
      dryRun: Boolean(body.dryRun),
      batchSize: Number(body.batchSize ?? 500),
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Error inesperado restaurando archivo." }, { status: 500 })
  }
}
