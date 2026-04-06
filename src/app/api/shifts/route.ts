import { NextResponse } from "next/server"
import { buildStationKey, resolveStationReference } from "@/lib/stations"
import { isOfficerAuthorizedForStation, loadAuthorizedOfficersForStation } from "@/lib/station-officer-authorizations"
import { isStationProfilesSchemaMissing, loadStationProfileForStation } from "@/lib/station-profiles"
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

type AttendanceScope = {
  key: string
  legacyLabel: string
}

const SCHEMA_HINT = "Ejecute supabase/add_l1_attendance.sql para habilitar entrada/salida por puesto."

function canOperateShiftMode(actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]>) {
  return isDirector(actor) || Number(actor.roleLevel ?? 0) <= 1
}

function buildWorkedMinutes(startedAt: string | null | undefined, endedAt: string | null | undefined) {
  const start = new Date(String(startedAt ?? ""))
  const end = new Date(String(endedAt ?? ""))
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return 0
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
}

function buildManualCloseNotes(existingNotes: string | null | undefined, nextNotes: string | null, actorEmail: string) {
  const parts = [String(existingNotes ?? "").trim()].filter(Boolean)
  const detail = String(nextNotes ?? "").trim()
  const timestamp = new Date().toLocaleString("es-CR")
  parts.push(`Cierre manual L4 por ${actorEmail} el ${timestamp}${detail ? ` · ${detail}` : ""}`)
  return parts.join("\n\n")
}

function buildRecoveredCloseNotes(existingNotes: string | null | undefined, requestedShiftId: string, resolvedShiftId: string) {
  if (!requestedShiftId || requestedShiftId === resolvedShiftId) {
    return String(existingNotes ?? "").trim() || null
  }

  const parts = [String(existingNotes ?? "").trim()].filter(Boolean)
  const timestamp = new Date().toLocaleString("es-CR")
  parts.push(`Cierre recuperado con estado local desfasado el ${timestamp} · turno solicitado ${requestedShiftId}, turno activo real ${resolvedShiftId}`)
  return parts.join("\n\n")
}

function mapAttendanceRow(row: AttendanceRow) {
  const checkInAt = row.check_in_at ?? null
  const checkOutAt = row.check_out_at ?? null
  const visibleStationLabel = String(row.station_post_name ?? row.station_label ?? "")
  return {
    id: String(row.id),
    stationLabel: visibleStationLabel,
    stationPostName: visibleStationLabel,
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

async function loadHistoryCandidates(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, scope: AttendanceScope) {
  const { data, error } = await admin
    .from("attendance_logs")
    .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes,created_by_device_email,created_at")
    .in("station_label", Array.from(new Set([scope.key, scope.legacyLabel].filter(Boolean))))
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

async function loadActiveShiftCandidates(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, scope: AttendanceScope) {
  const { data, error } = await admin
    .from("attendance_logs")
    .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes,created_by_device_email,created_at")
    .in("station_label", Array.from(new Set([scope.key, scope.legacyLabel].filter(Boolean))))
    .is("check_out_at", null)
    .order("check_in_at", { ascending: false })
    .limit(10)

  if (error) return { rows: null, error }
  return { rows: (data ?? []) as AttendanceRow[], error: null }
}

async function filterAttendanceRowsForStation(
  admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>,
  station: ReturnType<typeof resolveStationReference>,
  rows: AttendanceRow[]
) {
  const authorizationCache = new Map<string, boolean>()
  const filtered: AttendanceRow[] = []

  for (const row of rows) {
    const rowStationLabel = String(row.station_label ?? "").trim()
    if (rowStationLabel === station.key) {
      filtered.push(row)
      continue
    }

    const rowStationPostName = String(row.station_post_name ?? row.station_label ?? "").trim()
    if (!rowStationPostName || rowStationPostName.toLowerCase() !== String(station.postName ?? "").trim().toLowerCase()) {
      continue
    }

    const officerUserId = String(row.officer_user_id ?? "").trim()
    if (!officerUserId) continue

    if (!authorizationCache.has(officerUserId)) {
      const authorization = await isOfficerAuthorizedForStation(admin, officerUserId, station)
      authorizationCache.set(officerUserId, Boolean(authorization.ok && authorization.isAuthorized))
    }

    if (authorizationCache.get(officerUserId)) {
      filtered.push(row)
    }
  }

  return filtered
}

async function resolveScopedStationForActor(
  admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]>,
  requestedLabel?: string | null,
  requestedPostName?: string | null
) {
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

  if (!candidate) {
    return { ok: false as const, status: 400, error: "Falta indicar el puesto operativo actual.", station: null, stationLabel: "", stationPostName: "" }
  }

  const station = resolveStationReference({ assigned: actor.assigned, stationLabel: candidate })
  const authorization = await isOfficerAuthorizedForStation(admin, actor.userId, station)
  if (!authorization.ok) {
    if (authorization.source === "schema-missing") {
      return { ok: false as const, status: 503, error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de operar puestos L1.", station: null, stationLabel: "", stationPostName: "" }
    }
    return { ok: false as const, status: 500, error: "No se pudo validar autorización del oficial para este puesto.", station: null, stationLabel: "", stationPostName: "" }
  }

  if (!authorization.isAuthorized) {
    return { ok: false as const, status: 403, error: "El oficial no está autorizado para consultar u operar este puesto.", station: null, stationLabel: "", stationPostName: "" }
  }

  return {
    ok: true as const,
    status: 200,
    error: null,
    station,
    stationLabel: station.postName || station.label,
    stationPostName: station.postName || station.label,
  }
}

async function validateOperationalStation(admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>, actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]>, station: ReturnType<typeof resolveStationReference>) {
  if (isDirector(actor)) {
    return { ok: true as const, status: 200, error: null, profile: null }
  }

  const result = await loadStationProfileForStation(admin, station)
  if (!result.ok) {
    if (isStationProfilesSchemaMissing(String(result.error ?? ""))) {
      return { ok: false as const, status: 503, error: "Aplique la migración supabase/add_station_profiles.sql antes de operar turnos L1 por puesto.", profile: null }
    }
    return { ok: false as const, status: 500, error: "No se pudo validar el registro operativo del puesto.", profile: null }
  }

  if (!result.record) {
    return { ok: false as const, status: 403, error: "Este puesto todavía no está registrado en L1 operativo. Pídalo en Centro Operativo.", profile: null }
  }

  if (!result.record.catalogIsActive || !result.record.isEnabled) {
    return { ok: false as const, status: 403, error: "Este puesto está pausado para L1 operativo. Reactívelo en Centro Operativo.", profile: result.record }
  }

  return { ok: true as const, status: 200, error: null, profile: result.record }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const url = new URL(request.url)
  const requestedLabel = String(url.searchParams.get("stationLabel") ?? "").trim()
  const requestedPostName = String(url.searchParams.get("stationPostName") ?? "").trim()
  const scopedStation = await resolveScopedStationForActor(admin, actor, requestedLabel, requestedPostName)
  if (!scopedStation.ok || !scopedStation.station) {
    return NextResponse.json({ error: scopedStation.error }, { status: scopedStation.status })
  }
  const station = scopedStation.station
  const stationPostName = scopedStation.stationPostName
  const stationLabel = scopedStation.stationLabel
  const attendanceScope = { key: station.key, legacyLabel: stationPostName }
  const shouldLoadOfficerRoster = canOperateShiftMode(actor)
  const officers = shouldLoadOfficerRoster ? await loadAuthorizedOfficersForStation(admin, station, stationPostName) : { rows: [], error: null }
  if (officers.error) {
    if (String(officers.error.message ?? "").toLowerCase().includes("station_officer_authorizations")) {
      return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de operar puestos L1." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudo cargar la lista de oficiales L1." }, { status: 500 })
  }

  const activeShift = await loadActiveShiftCandidates(admin, attendanceScope)
  const history = await loadHistoryCandidates(admin, attendanceScope)
  const schemaError = activeShift.error ?? history.error
  if (schemaError) {
    const message = String(schemaError.message ?? "")
    if (message.toLowerCase().includes("attendance_logs")) {
      return NextResponse.json({ attendanceModeAvailable: false, message: SCHEMA_HINT, history: [], activeShift: null, officers: officers.rows ?? [] })
    }
    return NextResponse.json({ error: "No se pudo consultar entrada/salida del puesto." }, { status: 500 })
  }

  const filteredHistoryRows = history.rows ? await filterAttendanceRowsForStation(admin, station, history.rows) : []
  const filteredActiveShiftRows = activeShift.rows ? await filterAttendanceRowsForStation(admin, station, activeShift.rows) : []

  return NextResponse.json({
    attendanceModeAvailable: true,
    message: null,
    history: filteredHistoryRows.map(mapAttendanceRow),
    activeShift: filteredActiveShiftRows[0] ? mapAttendanceRow(filteredActiveShiftRows[0]) : null,
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

  if (!canOperateShiftMode(actor)) {
    return NextResponse.json({ error: "Solo L1 o L4 pueden operar entrada/salida de turnos por puesto." }, { status: 403 })
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
    const scopedStation = await resolveScopedStationForActor(admin, actor, requestedLabel, requestedPostName)
    if (!scopedStation.ok || !scopedStation.station) {
      return NextResponse.json({ error: scopedStation.error }, { status: scopedStation.status })
    }
    const station = scopedStation.station
    const stationPostName = scopedStation.stationPostName
    const stationLabel = scopedStation.stationLabel
    const attendanceScope = { key: station.key, legacyLabel: stationPostName }
    const action = String(body.action ?? "check_in").trim().toLowerCase()
    const notes = String(body.notes ?? "").trim() || null

    if (action === "check_out") {
      const activeShiftCandidates = await loadActiveShiftCandidates(admin, attendanceScope)
      const activeShiftRows = activeShiftCandidates.rows ? await filterAttendanceRowsForStation(admin, station, activeShiftCandidates.rows) : null
      const activeShiftResult = { row: activeShiftRows?.[0] ?? null, error: activeShiftCandidates.error }
      if (activeShiftResult.error) {
        const message = String(activeShiftResult.error.message ?? "")
        if (message.toLowerCase().includes("attendance_logs")) {
          return NextResponse.json({ error: SCHEMA_HINT }, { status: 503 })
        }
        return NextResponse.json({ error: "No se pudo validar el turno activo del puesto." }, { status: 500 })
      }

      const activeShift = activeShiftResult.row
      const requestedShiftId = String(body.activeShiftId ?? "").trim()
      if (!activeShift?.id) {
        return NextResponse.json({ error: "No hay un turno activo para marcar salida." }, { status: 409 })
      }

      const checkOutAt = new Date().toISOString()
      const workedMinutes = buildWorkedMinutes(activeShift.check_in_at, checkOutAt)
      const recoveredNotes = buildRecoveredCloseNotes(activeShift.notes, requestedShiftId, String(activeShift.id))
      const effectiveNotes = isDirector(actor)
        ? buildManualCloseNotes(activeShift.notes, notes, actor.email)
        : (notes ?? recoveredNotes)
      const { error: updateError } = await admin
        .from("attendance_logs")
        .update({
          check_out_at: checkOutAt,
          worked_minutes: workedMinutes,
          notes: effectiveNotes,
        })
        .eq("id", activeShift.id)

      if (updateError) {
        return NextResponse.json({ error: "No se pudo registrar la salida del oficial." }, { status: 500 })
      }

      const history = await loadHistoryCandidates(admin, attendanceScope)
      if (history.error) {
        return NextResponse.json({ error: "La salida se guardó, pero no se pudo refrescar el historial." }, { status: 500 })
      }

      const filteredHistoryRows = history.rows ? await filterAttendanceRowsForStation(admin, station, history.rows) : []

      return NextResponse.json({
        ok: true,
        attendanceModeAvailable: true,
        activeShift: null,
        history: filteredHistoryRows.map(mapAttendanceRow),
        station: {
          label: stationLabel,
          postName: stationPostName,
          key: buildStationKey(station.operationName, stationPostName),
          operationName: station.operationName,
        },
      })
    }

    const operationalStation = await validateOperationalStation(admin, actor, station)
    if (!operationalStation.ok) {
      return NextResponse.json({ error: operationalStation.error, stationProfile: operationalStation.profile }, { status: operationalStation.status })
    }

    const activeShiftCandidates = await loadActiveShiftCandidates(admin, attendanceScope)
    const activeShiftRows = activeShiftCandidates.rows ? await filterAttendanceRowsForStation(admin, station, activeShiftCandidates.rows) : null
    const activeShiftResult = { row: activeShiftRows?.[0] ?? null, error: activeShiftCandidates.error }
    if (activeShiftResult.error) {
      const message = String(activeShiftResult.error.message ?? "")
      if (message.toLowerCase().includes("attendance_logs")) {
        return NextResponse.json({ error: SCHEMA_HINT }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo validar el turno activo del puesto." }, { status: 500 })
    }

    const officerUserId = String(body.officerUserId ?? "").trim()
    if (!officerUserId) {
      return NextResponse.json({ error: "Seleccione el oficial que entra al puesto." }, { status: 400 })
    }

    if (activeShiftResult.row?.id) {
      return NextResponse.json({ error: `Ya hay un oficial en turno: ${String(activeShiftResult.row.officer_name ?? "Oficial")}. Marque la salida antes de iniciar otro turno.` }, { status: 409 })
    }

    const officers = await loadAuthorizedOfficersForStation(admin, station, stationPostName)
    if (officers.error || !officers.rows) {
      return NextResponse.json({ error: "No se pudieron validar credenciales del oficial." }, { status: 500 })
    }

    const officerRow = officers.rows.find((candidate) => String(candidate.id ?? "").trim() === officerUserId)

    if (!officerRow) {
      return NextResponse.json({ error: "El oficial no está autorizado o disponible para este puesto." }, { status: 404 })
    }

    const checkInAt = new Date().toISOString()
    const officerName = String(officerRow.name ?? officerRow.email ?? "Oficial").trim() || "Oficial"
    const officerEmail = String(officerRow.email ?? "").trim().toLowerCase() || null

    const { data: inserted, error: insertError } = await admin
      .from("attendance_logs")
      .insert({
        station_label: station.key,
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

    const history = await loadHistoryCandidates(admin, attendanceScope)
    if (history.error) {
      return NextResponse.json({ error: "La entrada se guardó, pero no se pudo refrescar el historial." }, { status: 500 })
    }

    const filteredHistoryRows = history.rows ? await filterAttendanceRowsForStation(admin, station, history.rows) : []

    return NextResponse.json({
      ok: true,
      attendanceModeAvailable: true,
      activeShift: inserted ? mapAttendanceRow(inserted as AttendanceRow) : null,
      history: filteredHistoryRows.map(mapAttendanceRow),
      stationProfile: operationalStation.profile,
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