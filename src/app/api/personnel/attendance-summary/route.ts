import { NextResponse } from "next/server"
import { getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"

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
}

type OfficerRow = {
  id: string
  first_name?: string | null
  email?: string | null
  assigned?: string | null
  status?: string | null
  role_level?: number | null
}

function toIsoDay(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function computeWorkedMinutes(row: AttendanceRow) {
  const explicitMinutes = Number(row.worked_minutes ?? 0)
  if (Number.isFinite(explicitMinutes) && explicitMinutes > 0) return explicitMinutes
  const startedAt = row.check_in_at ? new Date(row.check_in_at) : null
  const endedAt = row.check_out_at ? new Date(row.check_out_at) : null
  if (!startedAt || !endedAt || Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime()) || endedAt <= startedAt) {
    return 0
  }
  return Math.max(1, Math.round((endedAt.getTime() - startedAt.getTime()) / 60000))
}

function buildEmptySummary(officer: OfficerRow) {
  return {
    officerUserId: String(officer.id ?? ""),
    officerName: String(officer.first_name ?? officer.email ?? "Oficial").trim() || "Oficial",
    officerEmail: String(officer.email ?? "").trim().toLowerCase(),
    assigned: String(officer.assigned ?? "").trim(),
    status: String(officer.status ?? "").trim(),
    totalWorkedMinutes: 0,
    totalWorkedHours: 0,
    workedDays: 0,
    completedShifts: 0,
    openShifts: 0,
    lastCheckInAt: null as string | null,
    lastCheckOutAt: null as string | null,
    recentPosts: [] as string[],
    recentNotesCount: 0,
    _days: new Set<string>(),
    recentShifts: [] as Array<{
      id: string
      stationLabel: string
      stationPostName: string
      checkInAt: string | null
      checkOutAt: string | null
      workedMinutes: number
      notes: string
      isOpen: boolean
    }>,
  }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const canViewPersonnel = isDirector(actor) || Number(actor.roleLevel ?? 0) >= 3 || hasCustomPermission(actor, "personnel_view")
  if (!canViewPersonnel) {
    return NextResponse.json({ error: "No autorizado para ver métricas de personal." }, { status: 403 })
  }

  const url = new URL(request.url)
  const userId = String(url.searchParams.get("userId") ?? "").trim()
  const days = Math.min(90, Math.max(7, Number(url.searchParams.get("days") ?? 30) || 30))
  const startDate = new Date()
  startDate.setHours(0, 0, 0, 0)
  startDate.setDate(startDate.getDate() - (days - 1))
  const startIso = startDate.toISOString()

  const officersQuery = admin
    .from("users")
    .select("id,first_name,email,assigned,status,role_level")
    .eq("role_level", 1)

  const attendanceQuery = admin
    .from("attendance_logs")
    .select("id,station_label,station_post_name,officer_user_id,officer_name,officer_email,check_in_at,check_out_at,worked_minutes,notes")
    .gte("check_in_at", startIso)
    .order("check_in_at", { ascending: false })

  const scopedAttendanceQuery = userId ? attendanceQuery.eq("officer_user_id", userId) : attendanceQuery
  const scopedOfficersQuery = userId ? officersQuery.eq("id", userId).limit(1) : officersQuery

  const [{ data: officers, error: officersError }, { data: attendance, error: attendanceError }] = await Promise.all([
    scopedOfficersQuery,
    scopedAttendanceQuery,
  ])

  if (officersError) {
    return NextResponse.json({ error: "No se pudo cargar el listado de oficiales." }, { status: 500 })
  }

  if (attendanceError) {
    const message = String(attendanceError.message ?? "")
    if (message.toLowerCase().includes("attendance_logs")) {
      return NextResponse.json({ error: "Falta ejecutar supabase/add_l1_attendance.sql para habilitar métricas RH." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudo cargar la asistencia del personal." }, { status: 500 })
  }

  const summaryMap = new Map<string, ReturnType<typeof buildEmptySummary>>()
  for (const officer of (officers ?? []) as OfficerRow[]) {
    summaryMap.set(String(officer.id), buildEmptySummary(officer))
  }

  for (const row of (attendance ?? []) as AttendanceRow[]) {
    const officerUserId = String(row.officer_user_id ?? "").trim()
    if (!officerUserId) continue
    const summary = summaryMap.get(officerUserId)
    if (!summary) continue

    const workedMinutes = computeWorkedMinutes(row)
    const stationLabel = String(row.station_label ?? row.station_post_name ?? "").trim()
    const stationPostName = String(row.station_post_name ?? row.station_label ?? "").trim()
    const dayKey = toIsoDay(row.check_in_at)

    summary.totalWorkedMinutes += workedMinutes
    if (row.check_out_at) summary.completedShifts += 1
    else summary.openShifts += 1
    if (dayKey) {
      summary.recentPosts = Array.from(new Set([...summary.recentPosts, stationPostName || stationLabel])).slice(0, 5)
      summary._days.add(dayKey)
    }
    if (row.notes && row.notes.trim()) summary.recentNotesCount += 1
    if (!summary.lastCheckInAt && row.check_in_at) summary.lastCheckInAt = row.check_in_at
    if (!summary.lastCheckOutAt && row.check_out_at) summary.lastCheckOutAt = row.check_out_at
    if (summary.recentShifts.length < 8) {
      summary.recentShifts.push({
        id: String(row.id),
        stationLabel,
        stationPostName,
        checkInAt: row.check_in_at ?? null,
        checkOutAt: row.check_out_at ?? null,
        workedMinutes,
        notes: String(row.notes ?? ""),
        isOpen: !row.check_out_at,
      })
    }
  }

  const summaries = Array.from(summaryMap.values()).map((summary) => {
    const daySet = summary._days
    return {
      ...summary,
      totalWorkedHours: Math.round((summary.totalWorkedMinutes / 60) * 10) / 10,
      workedDays: daySet.size,
    }
  }).sort((left, right) => right.totalWorkedMinutes - left.totalWorkedMinutes)

  const totalWorkedMinutes = summaries.reduce((acc, item) => acc + item.totalWorkedMinutes, 0)
  const totalWorkedDays = summaries.reduce((acc, item) => acc + item.workedDays, 0)
  const totalCompletedShifts = summaries.reduce((acc, item) => acc + item.completedShifts, 0)
  const totalOpenShifts = summaries.reduce((acc, item) => acc + item.openShifts, 0)

  return NextResponse.json({
    windowDays: days,
    generatedAt: new Date().toISOString(),
    summary: {
      officers: summaries.length,
      totalWorkedMinutes,
      totalWorkedHours: Math.round((totalWorkedMinutes / 60) * 10) / 10,
      totalWorkedDays,
      totalCompletedShifts,
      totalOpenShifts,
      averageWorkedHours: summaries.length ? Math.round(((totalWorkedMinutes / 60) / summaries.length) * 10) / 10 : 0,
    },
    officers: summaries,
  })
}