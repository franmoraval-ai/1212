import { NextResponse } from "next/server"
import { buildStationKey, resolveStationReference, stationMatchesAssigned } from "@/lib/stations"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type AttendanceRow = {
  id: string
  station_label?: string | null
  station_post_name?: string | null
  officer_user_id?: string | null
  officer_name?: string | null
  officer_email?: string | null
  check_in_at?: string | null
  check_out_at?: string | null
  worked_minutes?: number | null
  notes?: string | null
  created_by_device_email?: string | null
  created_at?: string | null
}

type OfficerRow = {
  id: string
  email?: string | null
  first_name?: string | null
  role_level?: number | null
  status?: string | null
  assigned?: string | null
}

const SCHEMA_HINT = "Ejecute supabase/add_l1_attendance.sql para habilitar entrada/salida por puesto."

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function buildWorkedMinutes(startedAt: string | null | undefined, endedAt: string | null | undefined) {
  const start = new Date(String(startedAt ?? ""))
  const end = new Date(String(endedAt ?? ""))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
}

function mapOfficerRow(row: OfficerRow, stationLabel: string) {
  const assigned = String(row.assigned ?? "").trim()
  const isAssignedHere = stationMatchesAssigned(stationLabel, assigned)
  const name = String(row.first_name ?? row.email ?? "Oficial").trim() || "Oficial"

  return {
    id: String(row.id),
    name,
    email: String(row.email ?? "").trim().toLowerCase(),
    assigned,
    status: String(row.status ?? "").trim(),
    isAssignedHere,
  }
}

async function loadOfficers(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, stationLabel: string) {
  const { data, error } = await admin
    .from("users")
    .select("id,email,first_name,role_level,status,assigned")
    .eq("role_level", 1)

  if (error) return { rows: null, error }

  const rows = ((data ?? []) as OfficerRow[])
    .filter((row) => ["", "activo", "active"].includes(normalizeStatus(row.status)))
    .map((row) => mapOfficerRow(row, stationLabel))
    .filter((row) => row.isAssignedHere)
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }))

  return { rows, error: null }
}

function mapAttendanceRow(row: AttendanceRow) {
  const checkInAt = row.check_in_at ?? null
  const checkOutAt = row.check_out_at ?? null
  return {
    id: String(row.id),
    stationLabel: String(row.station_label ?? row.station_post_name ?? ""),
    stationPostName: String(row.station_post_name ?? row.station_label ?? ""),
    officerUserId: String(row.officer_user_id ?? ""),
    officerName: String(row.officer_name ?? ""),
    officerEmail: String(row.officer_email ?? ""),
    checkInAt,
    checkOutAt,
    workedMinutes: Number(row.worked_minutes ?? buildWorkedMinutes(checkInAt, checkOutAt)),
    notes: String(row.notes ?? ""),
    createdByDeviceEmail: String(row.created_by_device_email ?? ""),
    createdAt: row.created_at ?? checkInAt,
    isOpen: !checkOutAt,
  }
}

async function loadHistory(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, stationLabel: string) {
  const { data, error } = await admin
    .from("attendance_logs")
    .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes,created_by_device_email,created_at")
    .eq("station_label", stationLabel)
    .order("check_in_at", { ascending: false })
    .limit(20)

  if (error) return { rows: null, error }
  return { rows: (data ?? []) as AttendanceRow[], error: null }
}

async function loadActiveShift(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, stationLabel: string) {
  const { data, error } = await admin
    .from("attendance_logs")
    .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes,created_by_device_email,created_at")
    .eq("station_label", stationLabel)
    .is("check_out_at", null)
    .order("check_in_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return { row: null, error }
  return { row: (data as AttendanceRow | null) ?? null, error: null }
}

function resolveScopedStationForActor(actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]>, requestedLabel?: string | null, requestedPostName?: string | null) {
  const candidate = String(requestedPostName ?? requestedLabel ?? "").trim()

  if (isDirector(actor)) {
    const target = resolveStationReference({ stationLabel: candidate || actor.assigned })
    return {
      ok: true,
      status: 200,
      error: null,
      station: target,
      stationLabel: target.postName || target.label,
      stationPostName: target.postName || target.label,
    }
  }

  const assignedStation = resolveStationReference({ assigned: actor.assigned })
  const assignedStationLabel = assignedStation.postName || assignedStation.label
  if (!assignedStationLabel) {
    return { ok: false, status: 403, error: "El usuario no tiene un puesto asignado para operar turnos.", station: null, stationLabel: "", stationPostName: "" }
  }

  if (candidate && !stationMatchesAssigned(candidate, actor.assigned)) {
    return { ok: false, status: 403, error: "No tiene permiso para consultar u operar turnos fuera de su puesto asignado.", station: null, stationLabel: "", stationPostName: "" }
  }

  return {
    ok: true,
    status: 200,
    error: null,
    station: assignedStation,
    stationLabel: assignedStationLabel,
    stationPostName: assignedStationLabel,
  }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const url = new URL(request.url)
  const requestedLabel = String(url.searchParams.get("stationLabel") ?? "").trim()
  const requestedPostName = String(url.searchParams.get("stationPostName") ?? "").trim()
  const scopedStation = resolveScopedStationForActor(actor, requestedLabel, requestedPostName)
  if (!scopedStation.ok || !scopedStation.station) {
    return NextResponse.json({ error: scopedStation.error }, { status: scopedStation.status })
  }
  const station = scopedStation.station
  const stationPostName = scopedStation.stationPostName
  const stationLabel = scopedStation.stationLabel
  const officers = await loadOfficers(admin, stationPostName)
  if (officers.error) {
    return NextResponse.json({ error: "No se pudo cargar la lista de oficiales L1." }, { status: 500 })
  }

  const activeShift = await loadActiveShift(admin, stationLabel)
  const history = await loadHistory(admin, stationLabel)
  const schemaError = activeShift.error ?? history.error
  if (schemaError) {
    const message = String(schemaError.message ?? "")
    if (message.toLowerCase().includes("attendance_logs")) {
      return NextResponse.json({ attendanceModeAvailable: false, message: SCHEMA_HINT, history: [], activeShift: null, officers: officers.rows ?? [] })
    }
    return NextResponse.json({ error: "No se pudo consultar entrada/salida del puesto." }, { status: 500 })
  }

  return NextResponse.json({
    attendanceModeAvailable: true,
    message: null,
    history: history.rows?.map(mapAttendanceRow) ?? [],
    activeShift: activeShift.row ? mapAttendanceRow(activeShift.row) : null,
    officers: officers.rows ?? [],
    station: {
      label: stationLabel,
      postName: stationPostName,
      key: station.key,
      operationName: station.operationName,
    },
  })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as {
      action?: string
      stationLabel?: string
      stationPostName?: string
      officerUserId?: string
      activeShiftId?: string
      notes?: string
    }

    const requestedLabel = String(body.stationLabel ?? "").trim()
    const requestedPostName = String(body.stationPostName ?? "").trim()
    const scopedStation = resolveScopedStationForActor(actor, requestedLabel, requestedPostName)
    if (!scopedStation.ok || !scopedStation.station) {
      return NextResponse.json({ error: scopedStation.error }, { status: scopedStation.status })
    }
    const station = scopedStation.station
    const stationPostName = scopedStation.stationPostName
    const stationLabel = scopedStation.stationLabel
    const action = String(body.action ?? "check_in").trim().toLowerCase()
    const notes = String(body.notes ?? "").trim() || null

    const activeShiftResult = await loadActiveShift(admin, stationLabel)
    if (activeShiftResult.error) {
      const message = String(activeShiftResult.error.message ?? "")
      if (message.toLowerCase().includes("attendance_logs")) {
        return NextResponse.json({ error: SCHEMA_HINT }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo validar el turno activo del puesto." }, { status: 500 })
    }

    if (action === "check_out") {
      const activeShift = activeShiftResult.row
      const activeShiftId = String(body.activeShiftId ?? activeShift?.id ?? "").trim()
      if (!activeShift?.id || (activeShiftId && String(activeShift.id) !== activeShiftId)) {
        return NextResponse.json({ error: "No hay un turno activo para marcar salida." }, { status: 409 })
      }

      const checkOutAt = new Date().toISOString()
      const workedMinutes = buildWorkedMinutes(activeShift.check_in_at, checkOutAt)
      const { error: updateError } = await admin
        .from("attendance_logs")
        .update({
          check_out_at: checkOutAt,
          worked_minutes: workedMinutes,
          notes: notes ?? activeShift.notes ?? null,
        })
        .eq("id", activeShift.id)

      if (updateError) {
        return NextResponse.json({ error: "No se pudo registrar la salida del oficial." }, { status: 500 })
      }

      const history = await loadHistory(admin, stationLabel)
      if (history.error) {
        return NextResponse.json({ error: "La salida se guardó, pero no se pudo refrescar el historial." }, { status: 500 })
      }

      return NextResponse.json({
        ok: true,
        attendanceModeAvailable: true,
        activeShift: null,
        history: history.rows?.map(mapAttendanceRow) ?? [],
        station: {
          label: stationLabel,
          postName: stationPostName,
          key: buildStationKey(station.operationName, stationPostName),
          operationName: station.operationName,
        },
      })
    }

    const officerUserId = String(body.officerUserId ?? "").trim()
    if (!officerUserId) {
      return NextResponse.json({ error: "Seleccione el oficial que entra al puesto." }, { status: 400 })
    }

    if (activeShiftResult.row?.id) {
      return NextResponse.json({ error: `Ya hay un oficial en turno: ${String(activeShiftResult.row.officer_name ?? "Oficial")}. Marque la salida antes de iniciar otro turno.` }, { status: 409 })
    }

    const { data: officers, error: officersError } = await admin
      .from("users")
      .select("id,email,first_name,role_level,status,assigned")
      .eq("role_level", 1)

    if (officersError) {
      return NextResponse.json({ error: "No se pudieron validar credenciales del oficial." }, { status: 500 })
    }

    const officerRow = ((officers ?? []) as OfficerRow[]).find((candidate) => String(candidate.id ?? "").trim() === officerUserId)

    if (!officerRow) {
      return NextResponse.json({ error: "El oficial seleccionado ya no está disponible." }, { status: 404 })
    }

    if (!stationMatchesAssigned(stationPostName, officerRow.assigned)) {
      return NextResponse.json({ error: "El oficial no está asignado a este puesto." }, { status: 400 })
    }

    const checkInAt = new Date().toISOString()
    const officerName = String(officerRow.first_name ?? officerRow.email ?? "Oficial").trim() || "Oficial"
    const officerEmail = String(officerRow.email ?? "").trim().toLowerCase() || null

    const { data: inserted, error: insertError } = await admin
      .from("attendance_logs")
      .insert({
        station_label: stationLabel,
        station_post_name: stationPostName,
        officer_user_id: officerRow.id,
        officer_name: officerName,
        officer_email: officerEmail,
        check_in_at: checkInAt,
        notes,
        created_by_device_email: actor.email,
        created_by_device_user_id: actor.uid,
        created_at: checkInAt,
      })
      .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes,created_by_device_email,created_at")
      .maybeSingle()

    if (insertError) {
      const message = String(insertError.message ?? "")
      if (message.toLowerCase().includes("attendance_logs")) {
        return NextResponse.json({ error: SCHEMA_HINT }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo registrar la entrada del oficial." }, { status: 500 })
    }

    const history = await loadHistory(admin, stationLabel)
    if (history.error) {
      return NextResponse.json({ error: "La entrada se guardó, pero no se pudo refrescar el historial." }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      attendanceModeAvailable: true,
      activeShift: inserted ? mapAttendanceRow(inserted as AttendanceRow) : null,
      history: history.rows?.map(mapAttendanceRow) ?? [],
      station: {
        label: stationLabel,
        postName: stationPostName,
        key: buildStationKey(station.operationName, stationPostName),
        operationName: station.operationName,
      },
    })
  } catch {
    return NextResponse.json({ error: "Error inesperado procesando entrada/salida del puesto." }, { status: 500 })
  }
}