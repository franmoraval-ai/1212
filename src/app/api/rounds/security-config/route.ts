import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type SecurityConfigBody = {
  geofenceRadiusMeters?: unknown
  noScanGapMinutes?: unknown
  maxJumpMeters?: unknown
}

function parseBoundedInteger(value: unknown, min: number, max: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return null
  const rounded = Math.round(numeric)
  if (rounded < min || rounded > max) return null
  return rounded
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ ok: false, error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ ok: false, error: "Solo L4 puede actualizar la configuración global de rondas." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as SecurityConfigBody
    const geofenceRadiusMeters = parseBoundedInteger(body.geofenceRadiusMeters, 20, 300)
    const noScanGapMinutes = parseBoundedInteger(body.noScanGapMinutes, 3, 30)
    const maxJumpMeters = parseBoundedInteger(body.maxJumpMeters, 60, 500)

    if (geofenceRadiusMeters == null || noScanGapMinutes == null || maxJumpMeters == null) {
      return NextResponse.json(
        {
          ok: false,
          error: "Valores fuera de rango. Geocerca: 20-300m, gap sin escaneo: 3-30 min, salto GPS: 60-500m.",
        },
        { status: 400 }
      )
    }

    const { error: upsertError } = await admin.from("round_security_config").upsert({
      id: "global",
      geofence_radius_meters: geofenceRadiusMeters,
      no_scan_gap_minutes: noScanGapMinutes,
      max_jump_meters: maxJumpMeters,
      updated_by: actor.email || actor.uid,
      updated_at: new Date().toISOString(),
    })

    if (upsertError) {
      return NextResponse.json(
        {
          ok: false,
          error: upsertError.message ?? "No se pudo guardar la configuración global de rondas.",
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      securityConfig: {
        geofenceRadiusMeters,
        noScanGapMinutes,
        maxJumpMeters,
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Error inesperado guardando la configuración global de rondas." }, { status: 500 })
  }
}