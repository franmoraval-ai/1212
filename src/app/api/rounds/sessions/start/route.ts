import { NextResponse } from "next/server"
import { resolveStationReference } from "@/lib/stations"
import { isOfficerAuthorizedForStation } from "@/lib/station-officer-authorizations"
import { isStationProfilesSchemaMissing, loadStationProfileForStation } from "@/lib/station-profiles"
import { getAuthenticatedActor } from "@/lib/server-auth"

function isActiveRoundStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "activa" || normalized === "active"
}

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

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

    const { data: round, error: roundError } = await admin
      .from("rounds")
      .select("id, name, post, status")
      .eq("id", roundId)
      .limit(1)
      .maybeSingle<{ id: string; name: string | null; post: string | null; status: string | null }>()

    if (roundError) {
      return NextResponse.json({ error: "No se pudo validar la ronda." }, { status: 500 })
    }

    if (!round?.id) {
      return NextResponse.json({ error: "Ronda no encontrada." }, { status: 404 })
    }

    if (!isActiveRoundStatus(round.status)) {
      return NextResponse.json({ error: "La ronda no esta activa." }, { status: 409 })
    }

    if (Number(actor.roleLevel ?? 0) <= 1) {
      const station = resolveStationReference({ stationLabel: round.post ?? body.postName ?? "" })
      const authorization = await isOfficerAuthorizedForStation(admin, actor.userId, station)
      if (!authorization.ok) {
        if (authorization.source === "schema-missing") {
          return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de operar rondas L1 por puesto." }, { status: 503 })
        }
        return NextResponse.json({ error: "No se pudo validar autorización del oficial para la ronda." }, { status: 500 })
      }

      if (!authorization.isAuthorized) {
        return NextResponse.json({ error: "La ronda no pertenece a un puesto autorizado para este oficial." }, { status: 403 })
      }

      const stationProfile = await loadStationProfileForStation(admin, station)
      if (!stationProfile.ok) {
        if (isStationProfilesSchemaMissing(String(stationProfile.error ?? ""))) {
          return NextResponse.json({ error: "Aplique la migración supabase/add_station_profiles.sql antes de operar rondas L1 por puesto." }, { status: 503 })
        }
        return NextResponse.json({ error: "No se pudo validar el registro operativo del puesto para la ronda." }, { status: 500 })
      }

      if (!stationProfile.record || !stationProfile.record.catalogIsActive || !stationProfile.record.isEnabled) {
        return NextResponse.json({ error: "El puesto de esta ronda no está habilitado en L1 operativo." }, { status: 403 })
      }
    }

    const startedAt = String(body.startedAt ?? "").trim() || new Date().toISOString()
    const checkpointsTotal = Number(body.checkpointsTotal ?? 0)

    const { data: existingSession, error: existingSessionError } = await admin
      .from("round_sessions")
      .select("id")
      .eq("round_id", roundId)
      .eq("officer_id", actor.uid)
      .eq("started_at", startedAt)
      .limit(1)
      .maybeSingle<{ id: string }>()

    if (existingSessionError) {
      return NextResponse.json({ error: "No se pudo validar duplicados de sesión." }, { status: 500 })
    }

    if (existingSession?.id) {
      return NextResponse.json({ ok: true, sessionId: existingSession.id })
    }

    const payload = {
      round_id: roundId,
      round_name: String(body.roundName ?? "").trim() || String(round.name ?? "").trim() || null,
      post_name: String(body.postName ?? "").trim() || String(round.post ?? "").trim() || null,
      officer_id: actor.uid,
      officer_name: String(body.officerName ?? actor.firstName ?? actor.email).trim() || actor.email,
      supervisor_id: null,
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
