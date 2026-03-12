import { createHash } from "node:crypto"
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

function normalizeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
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
      roundId?: string
      checkpointId?: string
      checkpointName?: string
      eventType?: string
      token?: string
      lat?: number
      lng?: number
      accuracy?: number
      distanceToTargetMeters?: number
      insideGeofence?: boolean
      fraudFlag?: string | null
      capturedAt?: string
    }

    const roundId = String(body.roundId ?? "").trim()
    const checkpointId = String(body.checkpointId ?? "").trim()
    const eventType = String(body.eventType ?? "").trim()

    if (!roundId || !checkpointId || !eventType) {
      return NextResponse.json({ error: "roundId, checkpointId y eventType son obligatorios." }, { status: 400 })
    }

    const token = String(body.token ?? "").trim()
    const tokenHash = token ? createHash("sha256").update(token).digest("hex") : null
    const capturedAt = String(body.capturedAt ?? "").trim() || new Date().toISOString()
    const lat = normalizeNumber(body.lat)
    const lng = normalizeNumber(body.lng)
    const accuracy = normalizeNumber(body.accuracy)

    const payload = {
      session_id: cleanSessionId,
      round_id: roundId,
      checkpoint_id: checkpointId,
      checkpoint_name: String(body.checkpointName ?? "").trim() || null,
      event_type: eventType,
      token_hash: tokenHash,
      lat,
      lng,
      accuracy_meters: accuracy,
      distance_to_target_meters: normalizeNumber(body.distanceToTargetMeters),
      inside_geofence: typeof body.insideGeofence === "boolean" ? body.insideGeofence : null,
      fraud_flag: String(body.fraudFlag ?? "").trim() || null,
      captured_at: capturedAt,
    }

    const { error: insertError } = await admin.from("round_checkpoint_events").insert(payload)
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    const statusForSession = eventType === "checkpoint_unmatched" ? undefined : "in_progress"
    const locationPayload = lat != null && lng != null
      ? {
          lat,
          lng,
          accuracy,
          recorded_at: capturedAt,
        }
      : null

    const sessionUpdate: Record<string, unknown> = {
      last_scan_at: capturedAt,
      updated_at: new Date().toISOString(),
    }

    if (statusForSession) {
      sessionUpdate.status = statusForSession
    }
    if (locationPayload) {
      sessionUpdate.last_location = locationPayload
    }

    await admin.from("round_sessions").update(sessionUpdate).eq("id", cleanSessionId)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando evento de ronda." }, { status: 500 })
  }
}
