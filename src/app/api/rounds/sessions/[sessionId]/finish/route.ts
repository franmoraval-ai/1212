import { NextResponse } from "next/server"
import { getAuthorizedRoundSession } from "@/lib/round-session-access"
import { getAuthenticatedActor } from "@/lib/server-auth"

function normalizeFinishStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (normalized === "completed" || normalized === "completa") return "completed"
  if (normalized === "partial" || normalized === "parcial") return "partial"
  if (normalized === "cancelled" || normalized === "cancelada") return "cancelled"
  return null
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    const { sessionId } = await context.params
    const cleanSessionId = String(sessionId ?? "").trim()
    if (!cleanSessionId) {
      return NextResponse.json({ error: "sessionId es obligatorio." }, { status: 400 })
    }

    const sessionAccess = await getAuthorizedRoundSession(admin, cleanSessionId, actor)
    if (!sessionAccess.session) {
      return NextResponse.json({ error: sessionAccess.error }, { status: sessionAccess.status })
    }

    const body = (await request.json()) as {
      endedAt?: string
      status?: string
      checkpointsCompleted?: number
      checkpointsTotal?: number
      notes?: string | null
      reportId?: string | null
    }

    const endedAt = String(body.endedAt ?? "").trim() || new Date().toISOString()
    const nextStatus = normalizeFinishStatus(body.status ?? "completed")
    const checkpointsCompleted = Number(body.checkpointsCompleted ?? 0)
    const checkpointsTotal = Number(body.checkpointsTotal ?? 0)

    if (!nextStatus) {
      return NextResponse.json({ error: "status invalido." }, { status: 400 })
    }

    const updatePayload = {
      ended_at: endedAt,
      status: nextStatus,
      checkpoints_completed: Number.isFinite(checkpointsCompleted) ? Math.max(0, Math.floor(checkpointsCompleted)) : 0,
      checkpoints_total: Number.isFinite(checkpointsTotal) ? Math.max(0, Math.floor(checkpointsTotal)) : 0,
      updated_at: new Date().toISOString(),
      last_scan_at: endedAt,
      fraud_score: null,
      last_location: null,
      post_name: undefined,
      round_name: undefined,
      supervisor_id: undefined,
    } as Record<string, unknown>

    const cleanNotes = String(body.notes ?? "").trim()
    const cleanReportId = String(body.reportId ?? "").trim()

    if (cleanNotes || cleanReportId) {
      updatePayload.last_location = {
        report_id: cleanReportId || null,
        notes: cleanNotes || null,
        ended_at: endedAt,
      }
    }

    const { error: updateError } = await admin
      .from("round_sessions")
      .update(updatePayload)
      .eq("id", cleanSessionId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado cerrando sesion de ronda." }, { status: 500 })
  }
}
