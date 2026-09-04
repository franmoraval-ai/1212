import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/server-auth"
import { hasValidWhatsappBotSecret } from "@/lib/whatsapp-bot-auth"
import { resolveStationReference } from "@/lib/stations"
import { findAuthorizedOfficerForStation } from "@/lib/whatsapp-officer-lookup"

type AttendanceBody = {
  type?: unknown
  officerQuery?: unknown
  stationQuery?: unknown
  occurredAt?: unknown
  sourceMessageId?: unknown
  groupId?: unknown
}

type OpenAttendanceRow = {
  id: string
  check_in_at?: string | null
  notes?: string | null
  officer_user_id?: string | null
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

  let body: AttendanceBody
  try {
    body = (await request.json()) as AttendanceBody
  } catch {
    return NextResponse.json({ error: "Cuerpo invalido." }, { status: 400 })
  }

  const type = body.type === "check_out" ? "check_out" : body.type === "check_in" ? "check_in" : null
  const officerQuery = normalizeText(body.officerQuery)
  const stationQuery = normalizeText(body.stationQuery)

  if (!type || !officerQuery || !stationQuery) {
    return NextResponse.json({ error: "Faltan datos: tipo, oficial o puesto." }, { status: 400 })
  }

  const station = resolveStationReference({ stationLabel: stationQuery })
  const lookup = await findAuthorizedOfficerForStation(admin, station, officerQuery)
  if (!lookup.ok) {
    return buildLookupErrorResponse(lookup.reason, stationQuery, officerQuery, lookup.candidates)
  }

  const officer = lookup.officer
  const occurredAt = normalizeText(body.occurredAt) || new Date().toISOString()
  const sourceTag = [
    "WhatsApp bot",
    normalizeText(body.groupId) ? `grupo ${normalizeText(body.groupId)}` : "",
    normalizeText(body.sourceMessageId) ? `msg ${normalizeText(body.sourceMessageId)}` : "",
  ].filter(Boolean).join(" · ")

  if (type === "check_in") {
    const { data: openRow, error: openRowError } = await admin
      .from("attendance_logs")
      .select("id")
      .eq("station_label", station.label)
      .is("check_out_at", null)
      .maybeSingle()

    if (openRowError) {
      return NextResponse.json({ error: openRowError.message }, { status: 500 })
    }
    if (openRow) {
      return NextResponse.json({ error: `Ya hay un turno abierto en "${station.label}".` }, { status: 409 })
    }

    const { error: insertError } = await admin.from("attendance_logs").insert({
      station_label: station.label,
      station_post_name: station.postName,
      officer_user_id: officer.id,
      officer_name: officer.name,
      officer_email: officer.email || null,
      check_in_at: occurredAt,
      notes: sourceTag,
      created_by_device_email: "whatsapp-bot",
    })

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, officerName: officer.name, stationLabel: station.label, type })
  }

  const { data: openShiftData, error: openShiftError } = await admin
    .from("attendance_logs")
    .select("id,check_in_at,notes,officer_user_id")
    .eq("station_label", station.label)
    .is("check_out_at", null)
    .maybeSingle()

  if (openShiftError) {
    return NextResponse.json({ error: openShiftError.message }, { status: 500 })
  }

  const openShift = openShiftData as OpenAttendanceRow | null
  if (!openShift) {
    return NextResponse.json({ error: `No hay turno abierto en "${station.label}".` }, { status: 404 })
  }
  if (openShift.officer_user_id && openShift.officer_user_id !== officer.id) {
    return NextResponse.json(
      { error: `El turno abierto en "${station.label}" pertenece a otro oficial.` },
      { status: 409 }
    )
  }

  const checkInAt = new Date(String(openShift.check_in_at ?? ""))
  const checkOutAt = new Date(occurredAt)
  const workedMinutes = Number.isNaN(checkInAt.getTime()) || Number.isNaN(checkOutAt.getTime()) || checkOutAt <= checkInAt
    ? 0
    : Math.max(1, Math.round((checkOutAt.getTime() - checkInAt.getTime()) / 60000))

  const { error: updateError } = await admin
    .from("attendance_logs")
    .update({
      check_out_at: occurredAt,
      worked_minutes: workedMinutes,
      notes: [String(openShift.notes ?? "").trim(), sourceTag].filter(Boolean).join(" · "),
    })
    .eq("id", openShift.id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, officerName: officer.name, stationLabel: station.label, type, workedMinutes })
}
