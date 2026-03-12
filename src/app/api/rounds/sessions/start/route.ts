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

export async function POST(request: Request) {
  try {
    const sessionClient = await createSessionClient()
    const {
      data: { user },
      error: authError,
    } = await sessionClient.auth.getUser()

    if (authError || !user?.id) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const { client: admin, error } = getAdmin()
    if (!admin) return NextResponse.json({ error }, { status: 500 })

    const body = (await request.json()) as {
      roundId?: string
      roundName?: string
      postName?: string
      officerId?: string
      officerName?: string
      supervisorId?: string
      startedAt?: string
      expectedEndAt?: string | null
      checkpointsTotal?: number
    }

    const roundId = String(body.roundId ?? "").trim()
    if (!roundId) {
      return NextResponse.json({ error: "roundId es obligatorio." }, { status: 400 })
    }

    const startedAt = String(body.startedAt ?? "").trim() || new Date().toISOString()
    const checkpointsTotal = Number(body.checkpointsTotal ?? 0)

    const payload = {
      round_id: roundId,
      round_name: String(body.roundName ?? "").trim() || null,
      post_name: String(body.postName ?? "").trim() || null,
      officer_id: String(body.officerId ?? user.id).trim() || user.id,
      officer_name: String(body.officerName ?? user.email ?? "").trim() || null,
      supervisor_id: String(body.supervisorId ?? "").trim() || null,
      status: "in_progress",
      started_at: startedAt,
      expected_end_at: String(body.expectedEndAt ?? "").trim() || null,
      checkpoints_total: Number.isFinite(checkpointsTotal) ? Math.max(0, Math.floor(checkpointsTotal)) : 0,
      checkpoints_completed: 0,
      last_scan_at: startedAt,
      updated_at: new Date().toISOString(),
    }

    const { data: inserted, error: insertError } = await admin
      .from("round_sessions")
      .insert(payload)
      .select("id")
      .single()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, sessionId: inserted?.id })
  } catch {
    return NextResponse.json({ error: "Error inesperado iniciando sesion de ronda." }, { status: 500 })
  }
}
