import { createHash } from "node:crypto"
import { NextResponse } from "next/server"
import { getAuthorizedRoundSession } from "@/lib/round-session-access"
import { getAuthenticatedActor } from "@/lib/server-auth"

function normalizeNumber(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isClosedSessionStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "completed" || normalized === "partial" || normalized === "cancelled"
}

const ALLOWED_EVENT_TYPES = new Set(["checkpoint_match", "checkpoint_unmatched"])

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

    if (isClosedSessionStatus(sessionAccess.session.status)) {
      return NextResponse.json({ error: "La sesión ya está cerrada." }, { status: 409 })
    }

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

    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return NextResponse.json({ error: "eventType invalido." }, { status: 400 })
    }

    if (roundId !== String(sessionAccess.session.round_id ?? "").trim()) {
      return NextResponse.json({ error: "La ronda no coincide con la sesión activa." }, { status: 400 })
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

    const { error: updateError } = await admin.from("round_sessions").update(sessionUpdate).eq("id", cleanSessionId)

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando evento de ronda." }, { status: 500 })
  }
}
