import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

function getAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return { client: null, error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEY en el servidor." }
  }

  return {
    client: createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    error: null,
  }
}

export async function POST(request: Request, context: { params: Promise<{ sessionId: string }> }) {
  try {
    const sessionClient = await createSessionClient()
    const {
      data: { user },
      error: authError,
    } = await sessionClient.auth.getUser()

    if (authError || !user?.id) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const { sessionId } = await context.params
    const cleanSessionId = String(sessionId ?? "").trim()
    if (!cleanSessionId) {
      return NextResponse.json({ error: "sessionId es obligatorio." }, { status: 400 })
    }

    const { client: admin, error } = getAdmin()
    if (!admin) return NextResponse.json({ error }, { status: 500 })

    const body = (await request.json()) as {
      endedAt?: string
      status?: string
      checkpointsCompleted?: number
      checkpointsTotal?: number
      notes?: string | null
      reportId?: string | null
    }

    const endedAt = String(body.endedAt ?? "").trim() || new Date().toISOString()
    const nextStatus = String(body.status ?? "completed").trim() || "completed"
    const checkpointsCompleted = Number(body.checkpointsCompleted ?? 0)
    const checkpointsTotal = Number(body.checkpointsTotal ?? 0)

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
