import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/server-auth"
import { hasValidWhatsappBotSecret } from "@/lib/whatsapp-bot-auth"
import { resolveStationReference } from "@/lib/stations"
import { findAuthorizedOfficerForStation } from "@/lib/whatsapp-officer-lookup"

type ReportBody = {
  officerQuery?: unknown
  stationQuery?: unknown
  tipo?: unknown
  descripcion?: unknown
  occurredAt?: unknown
  sourceMessageId?: unknown
  groupId?: unknown
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function buildLookupErrorResponse(
  reason: "schema-missing" | "station-not-found" | "not-found" | "ambiguous" | "error",
  stationQuery: string,
  officerQuery: string,
  candidates?: string[]
) {
  if (reason === "schema-missing") {
    return NextResponse.json({ error: "Puesto no configurado en el catálogo operativo." }, { status: 409 })
  }
  if (reason === "station-not-found") {
    return NextResponse.json({ error: `No encontré el puesto "${stationQuery}".` }, { status: 404 })
  }
  if (reason === "ambiguous") {
    return NextResponse.json(
      { error: `Varios oficiales coinciden con "${officerQuery}": ${(candidates ?? []).join(", ")}. Sea mas especifico.` },
      { status: 409 }
    )
  }
  return NextResponse.json(
    { error: `No encontré al oficial "${officerQuery}" autorizado en "${stationQuery}".` },
    { status: 404 }
  )
}

export async function POST(request: Request) {
  if (!hasValidWhatsappBotSecret(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 })
  }

  const { admin, error: adminError } = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: adminError ?? "Servicio no disponible." }, { status: 500 })
  }

  let body: ReportBody
  try {
    body = (await request.json()) as ReportBody
  } catch {
    return NextResponse.json({ error: "Cuerpo invalido." }, { status: 400 })
  }

  const officerQuery = normalizeText(body.officerQuery)
  const stationQuery = normalizeText(body.stationQuery)
  const tipo = normalizeText(body.tipo) || "Novedad"
  const descripcion = normalizeText(body.descripcion)

  if (!officerQuery || !stationQuery || !descripcion) {
    return NextResponse.json({ error: "Faltan datos: oficial, puesto o descripcion." }, { status: 400 })
  }

  const station = resolveStationReference({ stationLabel: stationQuery })
  const lookup = await findAuthorizedOfficerForStation(admin, station, officerQuery)
  if (!lookup.ok) {
    return buildLookupErrorResponse(lookup.reason, stationQuery, officerQuery, lookup.candidates)
  }

  const officer = lookup.officer
  const occurredAt = normalizeText(body.occurredAt) || new Date().toISOString()
  const sourceTag = [
    "Registrado via WhatsApp bot",
    normalizeText(body.groupId) ? `grupo ${normalizeText(body.groupId)}` : "",
    normalizeText(body.sourceMessageId) ? `msg ${normalizeText(body.sourceMessageId)}` : "",
  ].filter(Boolean).join(" · ")

  const { error: insertError } = await admin.from("incidents").insert({
    description: descripcion,
    incident_type: tipo,
    location: station.label,
    lugar: station.label,
    time: occurredAt,
    priority_level: "Media",
    reasoning: sourceTag,
    reported_by: officer.name,
    reported_by_user_id: officer.id,
    reported_by_email: officer.email || null,
    status: "Abierto",
  })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, officerName: officer.name, stationLabel: station.label, incidentType: tipo })
}
