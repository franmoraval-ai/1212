import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"

function normalizeLatitude(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < -90 || numeric > 90) return null
  return numeric
}

function normalizeLongitude(value: unknown) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < -180 || numeric > 180) return null
  return numeric
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ ok: false, error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      lat?: unknown
      lng?: unknown
    }

    const lat = normalizeLatitude(body.lat)
    const lng = normalizeLongitude(body.lng)
    const createdAt = new Date().toISOString()

    const { error: insertError } = await admin.from("alerts").insert({
      type: "sos",
      user_id: actor.uid,
      user_email: actor.email,
      created_at: createdAt,
      ...(lat != null && lng != null ? { location: { lat, lng } } : {}),
    })

    if (insertError) {
      return NextResponse.json({ ok: false, error: insertError.message ?? "No se pudo enviar la alerta." }, { status: 500 })
    }

    return NextResponse.json({ ok: true, createdAt })
  } catch {
    return NextResponse.json({ ok: false, error: "Error inesperado enviando alerta SOS." }, { status: 500 })
  }
}