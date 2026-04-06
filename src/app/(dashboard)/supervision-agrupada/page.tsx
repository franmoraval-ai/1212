"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { useQrScanner } from "@/hooks/use-qr-scanner"
import { useSupervisionGroupedData } from "@/hooks/use-supervision-grouped-data"
import { fetchInternalApi } from "@/lib/internal-api"
import { FileSpreadsheet, FileDown, Search, ListChecks, Loader2, QrCode, Camera, ScanLine, Eye, ChevronLeft, ChevronRight, FilterX } from "lucide-react"

type SupervisionRow = {
  id: string
  createdAt?: { toDate?: () => Date }
  operationName?: string
  officerName?: string
  reviewPost?: string
  supervisorId?: string
  status?: string
  type?: string
  idNumber?: string
  officerPhone?: string
  weaponModel?: string
  weaponSerial?: string
  lugar?: string
  gps?: { lat?: number; lng?: number }
  checklist?: Record<string, unknown>
  checklistReasons?: Record<string, unknown>
  propertyDetails?: Record<string, unknown>
  photos?: unknown[]
  observations?: string
}

type UserRow = {
  id: string
  email?: string
  firstName?: string
}

type RoundReportRow = {
  id: string
  createdAt?: { toDate?: () => Date }
  startedAt?: { toDate?: () => Date }
  endedAt?: { toDate?: () => Date }
  roundId?: string
  roundName?: string
  postName?: string
  officerId?: string
  officerName?: string
  status?: string
  checkpointsTotal?: number
  checkpointsCompleted?: number
  notes?: string
  checkpointLogs?: Record<string, unknown>
}

type GroupedRow = {
  key: string
  date: string
  hour: string
  day: string
  puesto: string
  operacion: string
  supervisor: string
  usuarios: string[]
  total: number
  cumplim: number
  novedad: number
  latestMinutes: number
}

type GroupDetailRow = {
  id: string
  date: string
  hour: string
  day: string
  puesto: string
  supervisor: string
  usuario: string
  operacion: string
  status: string
  minutesOfDay: number
}

const UNKNOWN = "NO DEFINIDO"
const DETAIL_FETCH_BATCH_SIZE = 200

function toLocalDateKey(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function toLocalTimeKey(date: Date) {
  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  return `${hh}:${mm}`
}

function toWeekdayKey(date: Date) {
  const days = ["DOMINGO", "LUNES", "MARTES", "MIERCOLES", "JUEVES", "VIERNES", "SABADO"]
  return days[date.getDay()] ?? "DESCONOCIDO"
}

function parseTimeToMinutes(value: string) {
  const clean = String(value ?? "").trim()
  if (!clean) return null
  const [h, m] = clean.split(":").map((n) => Number(n))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function formatDurationFromSeconds(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function getRoundReportCode(row: RoundReportRow) {
  const date = row.createdAt?.toDate?.()
  const ymd = date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
    : "00000000"
  const idSuffix = String(row.id ?? "XXXXXX").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "XXXXXX"
  return `BR-${ymd}-${idSuffix}`
}

function getRoundGpsSummary(row: RoundReportRow) {
  const logs = (row.checkpointLogs ?? {}) as Record<string, unknown>
  const gpsTrack = Array.isArray(logs.gpsTrack)
    ? logs.gpsTrack
    : Array.isArray(logs.gps_track)
      ? logs.gps_track
      : []
  const first = (gpsTrack[0] ?? null) as { lat?: number; lng?: number } | null
  const last = (gpsTrack[gpsTrack.length - 1] ?? null) as { lat?: number; lng?: number } | null
  const distanceMeters = Number((logs.gpsDistanceMeters ?? logs.gps_distance_meters ?? 0) as number)
  const elapsedSeconds = Number((logs.elapsedSeconds ?? logs.elapsed_seconds ?? 0) as number)
  const alerts = ((logs.alerts as { messages?: unknown } | undefined)?.messages ?? []) as unknown[]

  const gpsInicio = first && typeof first.lat === "number" && typeof first.lng === "number"
    ? `${first.lat.toFixed(6)}, ${first.lng.toFixed(6)}`
    : "—"
  const gpsFin = last && typeof last.lat === "number" && typeof last.lng === "number"
    ? `${last.lat.toFixed(6)}, ${last.lng.toFixed(6)}`
    : "—"

  return {
    distanceKm: Number.isFinite(distanceMeters) ? (distanceMeters / 1000).toFixed(2) : "0.00",
    duration: Number.isFinite(elapsedSeconds) ? formatDurationFromSeconds(elapsedSeconds) : "00:00:00",
    gpsInicio,
    gpsFin,
    alertas: Array.isArray(alerts) ? alerts.map((m) => String(m)).filter(Boolean).join(" | ") || "—" : "—",
  }
}

function getRoundReportDate(row: RoundReportRow, field: "created" | "started" | "ended") {
  if (field === "created") return row.createdAt?.toDate?.() ?? null
  if (field === "started") return row.startedAt?.toDate?.() ?? null
  return row.endedAt?.toDate?.() ?? null
}

function formatRoundDateTime(value: Date | null) {
  return value?.toLocaleString?.() ?? "—"
}

function getRoundCompletionLabel(row: RoundReportRow) {
  const total = Number(row.checkpointsTotal ?? 0)
  const done = Number(row.checkpointsCompleted ?? 0)
  if (total <= 0) return "0%"
  return `${Math.round((done / total) * 100)}%`
}

function getRoundOperationalSummary(row: RoundReportRow) {
  const logs = (row.checkpointLogs ?? {}) as {
    pre_round?: {
      condition?: string
      notes?: string | null
      checklist?: {
        doorsClosed?: boolean
        lightsOk?: boolean
        perimeterOk?: boolean
        noStrangers?: boolean
      }
    }
    checkpoints?: unknown
    events?: unknown
    photos?: unknown
    shift_context?: {
      station_label?: string | null
      station_post_name?: string | null
      active_officer_name?: string | null
      session_user_email?: string | null
    } | null
  }

  const checkpoints = Array.isArray(logs.checkpoints)
    ? logs.checkpoints as Array<{ name?: string; completedAt?: string | null }>
    : []
  const events = Array.isArray(logs.events)
    ? logs.events as Array<{ qrValue?: string; type?: string; fraudFlag?: string | null }>
    : []
  const checklist = logs.pre_round?.checklist
  const completed = checkpoints
    .filter((item) => !!String(item.completedAt ?? "").trim())
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean)
    .join(" | ") || "Sin checkpoints completados"
  const pending = checkpoints
    .filter((item) => !String(item.completedAt ?? "").trim())
    .map((item) => String(item.name ?? "").trim())
    .filter(Boolean)
    .join(" | ") || "Sin pendientes"
  const manualValidations = events.filter((item) => String(item.qrValue ?? "").trim().toLowerCase() === "manual").length
  const unmatched = events.filter((item) => item.type === "checkpoint_unmatched").length
  const offGeofence = events.filter((item) => item.fraudFlag === "scan_outside_geofence").length
  const evidenceCount = Array.isArray(logs.photos) ? logs.photos.length : 0
  const shiftContext = [
    `Estacion: ${String(logs.shift_context?.station_label ?? logs.shift_context?.station_post_name ?? "—") || "—"}`,
    `Oficial activo: ${String(logs.shift_context?.active_officer_name ?? "—") || "—"}`,
    `Sesion: ${String(logs.shift_context?.session_user_email ?? "—") || "—"}`,
  ].join(" | ")

  return {
    preRoundCondition: String(logs.pre_round?.condition ?? "—") || "—",
    preRoundNotes: String(logs.pre_round?.notes ?? "—") || "—",
    checklist: [
      `Puertas ${checklist?.doorsClosed === true ? "SI" : checklist?.doorsClosed === false ? "NO" : "—"}`,
      `Luces ${checklist?.lightsOk === true ? "SI" : checklist?.lightsOk === false ? "NO" : "—"}`,
      `Perimetro ${checklist?.perimeterOk === true ? "SI" : checklist?.perimeterOk === false ? "NO" : "—"}`,
      `Sin extranos ${checklist?.noStrangers === true ? "SI" : checklist?.noStrangers === false ? "NO" : "—"}`,
    ].join(" | "),
    completed,
    pending,
    eventSummary: `Eventos ${events.length} | Manuales ${manualValidations} | No reconocidos ${unmatched} | Fuera geocerca ${offGeofence} | Evidencias ${evidenceCount}`,
    shiftContext,
  }
}

export default function SupervisionAgrupadaPage() {
  const { supabase } = useSupabase()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const {
    supervisions: reportesData,
    users: usersData,
    roundReports: roundReportsData,
    isLoading,
  } = useSupervisionGroupedData()

  const [search, setSearch] = useState("")
  const [viewMode, setViewMode] = useState<"SUPERVISIONES" | "RONDAS">("SUPERVISIONES")
  const [puestoFilter, setPuestoFilter] = useState("TODOS")
  const [operacionFilter, setOperacionFilter] = useState("TODOS")
  const [supervisorFilter, setSupervisorFilter] = useState("TODOS")
  const [usuarioFilter, setUsuarioFilter] = useState("TODOS")
  const [dayFilter, setDayFilter] = useState("TODOS")
  const [hourFrom, setHourFrom] = useState("")
  const [hourTo, setHourTo] = useState("")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [qrOpen, setQrOpen] = useState(false)
  const [qrInput, setQrInput] = useState("")
  const [groupDetailOpen, setGroupDetailOpen] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0)
  const [detailCache, setDetailCache] = useState<Record<string, SupervisionRow>>({})
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [isExportingExcel, setIsExportingExcel] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const isLoadingRoundReports = isLoading

  const supervisorLookup = useMemo(() => {
    const byId = new Map<string, string>()
    const byEmail = new Map<string, string>()

    ;(usersData ?? []).forEach((u) => {
      const label = String(u.firstName ?? u.email ?? "").trim()
      if (!label) return
      if (u.id) byId.set(String(u.id), label)
      const email = String(u.email ?? "").trim().toLowerCase()
      if (email) byEmail.set(email, label)
    })

    return { byId, byEmail }
  }, [usersData])

  const getSupervisorLabel = useCallback((rawValue: string) => {
    const raw = String(rawValue ?? "").trim()
    if (!raw) return UNKNOWN

    if (raw.includes("@")) {
      return supervisorLookup.byEmail.get(raw.toLowerCase()) ?? raw
    }

    if (raw === String(user?.uid ?? "")) {
      return String(user?.firstName ?? user?.email ?? raw)
    }

    return supervisorLookup.byId.get(raw) ?? raw
  }, [supervisorLookup, user])

  const scopedReportes = useMemo(() => {
    const all = reportesData ?? []
    const roleLevel = Number(user?.roleLevel ?? 1)
    const uid = String(user?.uid ?? "").trim().toLowerCase()
    const email = String(user?.email ?? "").trim().toLowerCase()
    const firstName = String(user?.firstName ?? "").trim().toLowerCase()
    const emailAlias = email.includes("@") ? email.split("@")[0] : email
    const assignedTokens = String(user?.assigned ?? "")
      .split(/[|,;]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)

    const belongsToCurrentUser = (r: SupervisionRow) => {
      const supervisorValue = String(r.supervisorId ?? "").trim().toLowerCase()
      const officerName = String(r.officerName ?? "").trim().toLowerCase()
      return (
        (!!supervisorValue && (supervisorValue === uid || supervisorValue === email)) ||
        (!!officerName && (officerName.includes(firstName) || officerName.includes(emailAlias)))
      )
    }

    const belongsToAssignedScope = (r: SupervisionRow) => {
      if (assignedTokens.length === 0) return false
      const operationValue = String(r.operationName ?? "").trim().toLowerCase()
      const postValue = String(r.reviewPost ?? "").trim().toLowerCase()
      return assignedTokens.some((token) => operationValue.includes(token) || postValue.includes(token))
    }

    if (roleLevel >= 3) {
      return all
    }

    if (roleLevel === 2) {
      return all.filter((r) => belongsToCurrentUser(r) || belongsToAssignedScope(r))
    }

    if (roleLevel <= 1) {
      return all.filter((r) => belongsToCurrentUser(r))
    }

    return []
  }, [reportesData, user])

  const scopedRoundReports = useMemo(() => {
    const all = roundReportsData ?? []
    const roleLevel = Number(user?.roleLevel ?? 1)
    const uid = String(user?.uid ?? "").trim().toLowerCase()
    const email = String(user?.email ?? "").trim().toLowerCase()
    const firstName = String(user?.firstName ?? "").trim().toLowerCase()
    const emailAlias = email.includes("@") ? email.split("@")[0] : email
    const assignedTokens = String(user?.assigned ?? "")
      .split(/[|,;]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)

    const belongsToCurrentUser = (r: RoundReportRow) => {
      const officerId = String(r.officerId ?? "").trim().toLowerCase()
      const officerName = String(r.officerName ?? "").trim().toLowerCase()
      return (
        (!!officerId && (officerId === uid || officerId === email)) ||
        (!!officerName && (officerName.includes(firstName) || officerName.includes(emailAlias)))
      )
    }

    const belongsToAssignedScope = (r: RoundReportRow) => {
      if (assignedTokens.length === 0) return false
      const operationValue = String(r.roundName ?? "").trim().toLowerCase()
      const postValue = String(r.postName ?? "").trim().toLowerCase()
      return assignedTokens.some((token) => operationValue.includes(token) || postValue.includes(token))
    }

    if (roleLevel >= 3) return all
    if (roleLevel === 2) return all.filter((r) => belongsToCurrentUser(r) || belongsToAssignedScope(r))
    if (roleLevel <= 1) return all.filter((r) => belongsToCurrentUser(r))
    return []
  }, [roundReportsData, user])

  const normalized = useMemo(() => {
    return scopedReportes.map((r) => {
      const dt = r.createdAt?.toDate?.()
      const day = dt instanceof Date && !Number.isNaN(dt.getTime())
        ? toLocalDateKey(dt)
        : "1970-01-01"
      const hour = dt instanceof Date && !Number.isNaN(dt.getTime())
        ? toLocalTimeKey(dt)
        : "00:00"
      const weekday = dt instanceof Date && !Number.isNaN(dt.getTime())
        ? toWeekdayKey(dt)
        : "DESCONOCIDO"

      const [hh, mm] = hour.split(":").map((n) => Number(n))
      const minutesOfDay = (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0)

      return {
        id: r.id,
        date: day,
        hour,
        weekday,
        minutesOfDay,
        puesto: String(r.reviewPost ?? "").trim() || UNKNOWN,
        supervisor: getSupervisorLabel(String(r.supervisorId ?? "")),
        usuario: String(r.officerName ?? "").trim() || UNKNOWN,
        operacion: String(r.operationName ?? "").trim() || UNKNOWN,
        status: String(r.status ?? "").trim().toUpperCase(),
      }
    })
  }, [scopedReportes, getSupervisorLabel])

  const puestos = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.puesto))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )
  const operaciones = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.operacion))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )
  const puestosByOperacion = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of normalized) {
      const op = String(row.operacion ?? "").trim() || UNKNOWN
      const post = String(row.puesto ?? "").trim() || UNKNOWN
      if (!map.has(op)) map.set(op, new Set())
      map.get(op)!.add(post)
    }
    return map
  }, [normalized])
  const supervisores = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.supervisor))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )
  const usuarios = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.usuario))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMinutes = parseTimeToMinutes(hourFrom)
    const toMinutes = parseTimeToMinutes(hourTo)

    return normalized.filter((r) => {
      if (puestoFilter !== "TODOS" && r.puesto !== puestoFilter) return false
      if (operacionFilter !== "TODOS" && r.operacion !== operacionFilter) return false
      if (supervisorFilter !== "TODOS" && r.supervisor !== supervisorFilter) return false
      if (usuarioFilter !== "TODOS" && r.usuario !== usuarioFilter) return false
      if (dayFilter !== "TODOS" && r.weekday !== dayFilter) return false
      if (fromDate && r.date < fromDate) return false
      if (toDate && r.date > toDate) return false
      if (fromMinutes !== null && r.minutesOfDay < fromMinutes) return false
      if (toMinutes !== null && r.minutesOfDay > toMinutes) return false

      if (!q) return true
      return (
        r.puesto.toLowerCase().includes(q) ||
        r.hour.toLowerCase().includes(q) ||
        r.weekday.toLowerCase().includes(q) ||
        r.supervisor.toLowerCase().includes(q) ||
        r.usuario.toLowerCase().includes(q) ||
        r.operacion.toLowerCase().includes(q)
      )
    })
  }, [normalized, search, puestoFilter, operacionFilter, supervisorFilter, usuarioFilter, dayFilter, fromDate, toDate, hourFrom, hourTo])

  const detailRows = useMemo<GroupDetailRow[]>(() => {
    return filtered.map((r) => ({
      id: String(r.id),
      date: r.date,
      hour: r.hour,
      day: r.weekday,
      puesto: r.puesto,
      supervisor: r.supervisor,
      usuario: r.usuario,
      operacion: r.operacion,
      status: r.status,
      minutesOfDay: r.minutesOfDay,
    }))
  }, [filtered])

  const mapDbRowToView = useCallback((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    const timestampKeys = ["created_at", "updated_at", "entry_time", "exit_time", "last_check", "time", "timestamp", "synced_at"]
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())
      if (timestampKeys.includes(k) && v) {
        out[camel] = { toDate: () => new Date(v as string) }
      } else {
        out[camel] = v
      }
    }
    out.id = row.id
    return out as SupervisionRow
  }, [])

  const mapDbRoundRowToView = useCallback((row: Record<string, unknown>) => {
    const out: Record<string, unknown> = {}
    const timestampKeys = ["created_at", "updated_at", "entry_time", "exit_time", "last_check", "time", "timestamp", "synced_at", "started_at", "ended_at"]
    for (const [k, v] of Object.entries(row)) {
      const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())
      if (timestampKeys.includes(k) && v) {
        out[camel] = { toDate: () => new Date(v as string) }
      } else {
        out[camel] = v
      }
    }
    out.id = row.id
    return out as RoundReportRow
  }, [])

  const fetchDetailedRowsByIds = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)))
    if (!uniqueIds.length) return [] as SupervisionRow[]

    const rows: SupervisionRow[] = []

    for (let i = 0; i < uniqueIds.length; i += DETAIL_FETCH_BATCH_SIZE) {
      const batchIds = uniqueIds.slice(i, i + DETAIL_FETCH_BATCH_SIZE)
      const response = await fetchInternalApi(
        supabase,
        "/api/supervision-grouped/details",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batchIds }),
          cache: "no-store",
        },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = await response.json().catch(() => null) as { rows?: Record<string, unknown>[]; error?: string } | null

      if (!response.ok || !Array.isArray(body?.rows)) {
        throw new Error(String(body?.error ?? "No se pudo cargar el detalle de supervisiones."))
      }

      rows.push(...body.rows.map(mapDbRowToView))
    }

    return rows
  }, [supabase, mapDbRowToView])

  const fetchDetailedRoundRowsByIds = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)))
    if (!uniqueIds.length) return [] as RoundReportRow[]

    const rows: RoundReportRow[] = []

    for (let i = 0; i < uniqueIds.length; i += DETAIL_FETCH_BATCH_SIZE) {
      const batchIds = uniqueIds.slice(i, i + DETAIL_FETCH_BATCH_SIZE)
      const response = await fetchInternalApi(
        supabase,
        "/api/supervision-grouped/round-report-details",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batchIds }),
          cache: "no-store",
        },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = await response.json().catch(() => null) as { rows?: Record<string, unknown>[]; error?: string } | null

      if (!response.ok || !Array.isArray(body?.rows)) {
        throw new Error(String(body?.error ?? "No se pudo cargar el detalle de boletas de ronda."))
      }

      rows.push(...body.rows.map(mapDbRoundRowToView))
    }

    return rows
  }, [mapDbRoundRowToView, supabase])

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>()

    for (const row of detailRows) {
      const key = `${row.date}|${row.puesto}|${row.supervisor}|${row.operacion}`
      const current = map.get(key)

      if (!current) {
        map.set(key, {
          key,
          date: row.date,
          hour: row.hour,
          day: row.day,
          puesto: row.puesto,
          operacion: row.operacion,
          supervisor: row.supervisor,
          usuarios: [row.usuario],
          total: 1,
          cumplim: row.status.includes("CUMPLIM") ? 1 : 0,
          novedad: row.status.includes("NOVEDAD") ? 1 : 0,
          latestMinutes: row.minutesOfDay,
        })
      } else {
        current.total += 1
        if (!current.usuarios.includes(row.usuario)) current.usuarios.push(row.usuario)
        if (row.status.includes("CUMPLIM")) current.cumplim += 1
        if (row.status.includes("NOVEDAD")) current.novedad += 1
        if (row.minutesOfDay > current.latestMinutes) {
          current.latestMinutes = row.minutesOfDay
          current.hour = row.hour
        }
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return b.latestMinutes - a.latestMinutes
    })
  }, [detailRows])

  const groupItemsByKey = useMemo(() => {
    const groupedItems = new Map<string, GroupDetailRow[]>()

    for (const row of detailRows) {
      const key = `${row.date}|${row.puesto}|${row.supervisor}|${row.operacion}`
      const bucket = groupedItems.get(key) ?? []
      bucket.push(row)
      groupedItems.set(key, bucket)
    }

    return groupedItems
  }, [detailRows])

  const selectedGroupItems = useMemo(
    () => (selectedGroupKey ? groupItemsByKey.get(selectedGroupKey) ?? [] : []),
    [selectedGroupKey, groupItemsByKey]
  )

  const selectedDetail = selectedGroupItems[selectedGroupIndex] ?? null
  const selectedDetailData = selectedDetail ? detailCache[selectedDetail.id] ?? null : null

  const openGroupDetail = useCallback((groupKey: string) => {
    setSelectedGroupKey(groupKey)
    setSelectedGroupIndex(0)
    setGroupDetailOpen(true)
  }, [])

  useEffect(() => {
    if (!groupDetailOpen || !selectedDetail) return
    if (detailCache[selectedDetail.id]) return

    let isActive = true
    setLoadingDetailId(selectedDetail.id)

    const load = async () => {
      try {
        const rows = await fetchDetailedRowsByIds([selectedDetail.id])
        if (!isActive || !rows.length) return
        setDetailCache((prev) => ({ ...prev, [selectedDetail.id]: rows[0] }))
      } catch {
        if (!isActive) return
        toast({ title: "No se pudo cargar detalle", description: "Intente nuevamente.", variant: "destructive" })
      } finally {
        if (isActive) setLoadingDetailId(null)
      }
    }

    void load()

    return () => {
      isActive = false
    }
  }, [groupDetailOpen, selectedDetail, detailCache, fetchDetailedRowsByIds, toast])

  const totalItems = filtered.length
  const totalGrupos = grouped.length

  const normalizedRounds = useMemo(() => {
    return scopedRoundReports.map((row) => {
      const dt = row.createdAt?.toDate?.()
      const date = dt instanceof Date && !Number.isNaN(dt.getTime()) ? toLocalDateKey(dt) : "1970-01-01"
      const hour = dt instanceof Date && !Number.isNaN(dt.getTime()) ? toLocalTimeKey(dt) : "00:00"
      const weekday = dt instanceof Date && !Number.isNaN(dt.getTime()) ? toWeekdayKey(dt) : "DESCONOCIDO"
      const [hh, mm] = hour.split(":").map((n) => Number(n))
      const minutesOfDay = (Number.isFinite(hh) ? hh : 0) * 60 + (Number.isFinite(mm) ? mm : 0)

      return {
        id: String(row.id),
        date,
        hour,
        weekday,
        minutesOfDay,
        puesto: String(row.postName ?? "").trim() || UNKNOWN,
        operacion: String(row.roundName ?? "").trim() || UNKNOWN,
        usuario: String(row.officerName ?? "").trim() || UNKNOWN,
      }
    })
  }, [scopedRoundReports])

  const roundPuestos = useMemo(
    () => Array.from(new Set(normalizedRounds.map((r) => r.puesto))).sort((a, b) => a.localeCompare(b)),
    [normalizedRounds]
  )
  const roundOperaciones = useMemo(
    () => Array.from(new Set(normalizedRounds.map((r) => r.operacion))).sort((a, b) => a.localeCompare(b)),
    [normalizedRounds]
  )
  const roundPuestosByOperacion = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const row of normalizedRounds) {
      const op = String(row.operacion ?? "").trim() || UNKNOWN
      const post = String(row.puesto ?? "").trim() || UNKNOWN
      if (!map.has(op)) map.set(op, new Set())
      map.get(op)!.add(post)
    }
    return map
  }, [normalizedRounds])
  const roundUsuarios = useMemo(
    () => Array.from(new Set(normalizedRounds.map((r) => r.usuario))).sort((a, b) => a.localeCompare(b)),
    [normalizedRounds]
  )

  const filteredRoundReports = useMemo(() => {
    const q = search.trim().toLowerCase()
    const fromMinutes = parseTimeToMinutes(hourFrom)
    const toMinutes = parseTimeToMinutes(hourTo)

    return scopedRoundReports.filter((row) => {
      const created = row.createdAt?.toDate?.()
      const dateKey = created instanceof Date && !Number.isNaN(created.getTime())
        ? toLocalDateKey(created)
        : "1970-01-01"
      const hourKey = created instanceof Date && !Number.isNaN(created.getTime())
        ? toLocalTimeKey(created)
        : "00:00"
      const dayKey = created instanceof Date && !Number.isNaN(created.getTime())
        ? toWeekdayKey(created)
        : "DESCONOCIDO"
      const minutesOfDay = parseTimeToMinutes(hourKey) ?? 0

      const post = String(row.postName ?? "").trim() || UNKNOWN
      const roundName = String(row.roundName ?? "").trim() || UNKNOWN
      const officer = String(row.officerName ?? "").trim() || UNKNOWN

      if (puestoFilter !== "TODOS" && post !== puestoFilter) return false
      if (operacionFilter !== "TODOS" && roundName !== operacionFilter) return false
      if (usuarioFilter !== "TODOS" && officer !== usuarioFilter) return false
      if (dayFilter !== "TODOS" && dayKey !== dayFilter) return false
      if (fromDate && dateKey < fromDate) return false
      if (toDate && dateKey > toDate) return false
      if (fromMinutes !== null && minutesOfDay < fromMinutes) return false
      if (toMinutes !== null && minutesOfDay > toMinutes) return false

      if (!q) return true
      return (
        roundName.toLowerCase().includes(q) ||
        post.toLowerCase().includes(q) ||
        officer.toLowerCase().includes(q) ||
        hourKey.toLowerCase().includes(q) ||
        dayKey.toLowerCase().includes(q) ||
        String(row.status ?? "").toLowerCase().includes(q) ||
        String(row.notes ?? "").toLowerCase().includes(q)
      )
    })
  }, [scopedRoundReports, search, puestoFilter, operacionFilter, usuarioFilter, dayFilter, fromDate, toDate, hourFrom, hourTo])

  const totalBoletas = filteredRoundReports.length
  const boletasCompletas = filteredRoundReports.filter((r) => String(r.status ?? "").toUpperCase() === "COMPLETA").length
  const activePuestos = useMemo(() => {
    if (operacionFilter === "TODOS") {
      return viewMode === "SUPERVISIONES" ? puestos : roundPuestos
    }

    const sourceMap = viewMode === "SUPERVISIONES" ? puestosByOperacion : roundPuestosByOperacion
    const values = Array.from(sourceMap.get(operacionFilter) ?? [])
    return values.sort((a, b) => a.localeCompare(b))
  }, [viewMode, operacionFilter, puestos, roundPuestos, puestosByOperacion, roundPuestosByOperacion])
  const activeOperaciones = viewMode === "SUPERVISIONES" ? operaciones : roundOperaciones
  const activeUsuarios = viewMode === "SUPERVISIONES" ? usuarios : roundUsuarios

  useEffect(() => {
    if (puestoFilter === "TODOS") return
    if (activePuestos.includes(puestoFilter)) return
    setPuestoFilter("TODOS")
  }, [activePuestos, puestoFilter])

  const clearFilters = () => {
    setSearch("")
    setPuestoFilter("TODOS")
    setOperacionFilter("TODOS")
    setSupervisorFilter("TODOS")
    setUsuarioFilter("TODOS")
    setDayFilter("TODOS")
    setHourFrom("")
    setHourTo("")
    setFromDate("")
    setToDate("")
  }

  const applyQrValue = useCallback((value: string) => {
    const clean = value.trim()
    if (!clean) return

    try {
      const parsed = JSON.parse(clean) as { id?: string; name?: string; post?: string }
      const composed = [parsed.name, parsed.post, parsed.id].filter(Boolean).join(" ").trim()
      setSearch(composed || clean)
      setQrInput(clean)
      toast({ title: "QR detectado", description: "Filtro aplicado al buscador." })
    } catch {
      setSearch(clean)
      setQrInput(clean)
      toast({ title: "QR detectado", description: "Filtro aplicado al buscador." })
    }
  }, [toast])

  const onQrDetected = useCallback((rawValue: string) => {
    applyQrValue(rawValue)
    setQrOpen(false)
  }, [applyQrValue])

  const { videoRef, isScanning, scanError, qrSupported, startScanner, stopScanner } = useQrScanner({
    onDetected: onQrDetected,
    autoStopOnDetected: true,
    errorNoCamera: "Este navegador no permite acceso a la camara.",
    errorCameraStart: "No se pudo iniciar la camara. Verifique permisos.",
  })

  const handleQrOpenChange = useCallback((open: boolean) => {
    setQrOpen(open)
    if (open) {
      void startScanner()
      return
    }
    stopScanner()
  }, [startScanner, stopScanner])

  const handleExportGroupedExcel = async () => {
    if (isExportingExcel) return
    setIsExportingExcel(true)
    const { exportToExcel } = await import("@/lib/export-utils")
    try {
      const yesNo = (value: unknown) => (value === true ? "SI" : "NO")
      const rowsData = await fetchDetailedRowsByIds(filtered.map((r) => r.id))
      const rows = rowsData.map((r) => ({
        fechaHora: r.createdAt?.toDate?.()?.toLocaleString?.() ?? "—",
        operacion: r.operationName || "—",
        tipo: r.type || "—",
        oficial: r.officerName || "—",
        cedula: r.idNumber || "—",
        telefono: r.officerPhone || "—",
        puesto: r.reviewPost || "—",
        estado: r.status || "—",
        lugar: r.lugar || "—",
        arma: r.weaponModel || "—",
        serieArma: r.weaponSerial || "—",
        uniforme: yesNo((r.checklist as Record<string, unknown> | undefined)?.uniform),
        equipo: yesNo((r.checklist as Record<string, unknown> | undefined)?.equipment),
        puntualidad: yesNo((r.checklist as Record<string, unknown> | undefined)?.punctuality),
        servicio: yesNo((r.checklist as Record<string, unknown> | undefined)?.service),
        justificaciones: [
          (r.checklistReasons as Record<string, unknown> | undefined)?.uniform,
          (r.checklistReasons as Record<string, unknown> | undefined)?.equipment,
          (r.checklistReasons as Record<string, unknown> | undefined)?.punctuality,
          (r.checklistReasons as Record<string, unknown> | undefined)?.service,
        ].map((v) => String(v ?? "").trim()).filter(Boolean).join(" | ") || "—",
        luz: (r.propertyDetails as Record<string, unknown> | undefined)?.luz || "—",
        perimetro: (r.propertyDetails as Record<string, unknown> | undefined)?.perimetro || "—",
        sacate: (r.propertyDetails as Record<string, unknown> | undefined)?.sacate || "—",
        danosPropiedad: (r.propertyDetails as Record<string, unknown> | undefined)?.danosPropiedad || "—",
        gps: (() => {
          const gps = (r.gps as { lat?: number; lng?: number } | undefined) ?? {}
          if (typeof gps.lat !== "number" || typeof gps.lng !== "number") return "—"
          return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
        })(),
        evidencias: Array.isArray(r.photos) ? r.photos.length : 0,
        observaciones: r.observations || "—",
      }))

      const result = await exportToExcel(rows, "Supervisión Agrupada", [
        { header: "FECHA/HORA", key: "fechaHora", width: 22 },
        { header: "OPERACIÓN", key: "operacion", width: 22 },
        { header: "TIPO", key: "tipo", width: 14 },
        { header: "OFICIAL", key: "oficial", width: 20 },
        { header: "CEDULA", key: "cedula", width: 14 },
        { header: "TELEFONO", key: "telefono", width: 14 },
        { header: "PUESTO", key: "puesto", width: 22 },
        { header: "ESTADO", key: "estado", width: 14 },
        { header: "LUGAR", key: "lugar", width: 25 },
        { header: "ARMA", key: "arma", width: 15 },
        { header: "SERIE ARMA", key: "serieArma", width: 16 },
        { header: "UNIFORME", key: "uniforme", width: 10 },
        { header: "EQUIPO", key: "equipo", width: 10 },
        { header: "PUNTUALIDAD", key: "puntualidad", width: 12 },
        { header: "SERVICIO", key: "servicio", width: 10 },
        { header: "JUSTIFICACIONES", key: "justificaciones", width: 45 },
        { header: "LUZ", key: "luz", width: 12 },
        { header: "PERÍMETRO", key: "perimetro", width: 12 },
        { header: "SACATE", key: "sacate", width: 12 },
        { header: "DAÑOS PROPIEDAD", key: "danosPropiedad", width: 32 },
        { header: "GPS", key: "gps", width: 24 },
        { header: "EVIDENCIAS", key: "evidencias", width: 10 },
        { header: "OBSERVACIONES", key: "observaciones", width: 45 },
      ], "HO_SUPERVISION_AGRUPADA_COMPLETA")

      if (result.ok) toast({ title: "Excel descargado", description: "Agrupación exportada correctamente." })
      else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
    } catch (error) {
      toast({
        title: "Error al exportar",
        description: error instanceof Error ? error.message : "No se pudo preparar la exportación.",
        variant: "destructive",
      })
    } finally {
      setIsExportingExcel(false)
    }
  }

  const handleExportDetailedPdf = async () => {
    if (isExportingPdf) return
    setIsExportingPdf(true)
    const { exportToPdf } = await import("@/lib/export-utils")
    try {
      const yesNo = (value: unknown) => (value === true ? "SI" : "NO")
      const rowsData = await fetchDetailedRowsByIds(filtered.map((r) => r.id))

      const rows = rowsData.map((r) => [
        r.createdAt?.toDate?.()?.toLocaleString?.() ?? "—",
        `${String(r.officerName || "—")}\nID:${String(r.idNumber || "—")}\nTEL:${String(r.officerPhone || "—")}`,
        `${String(r.operationName || "—")}\n${String(r.reviewPost || "—")}`,
        String(r.status || "—"),
        (() => {
          const gps = (r.gps as { lat?: number; lng?: number } | undefined) ?? {}
          if (typeof gps.lat !== "number" || typeof gps.lng !== "number") return "—"
          return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
        })(),
        `U:${yesNo((r.checklist as Record<string, unknown> | undefined)?.uniform)} E:${yesNo((r.checklist as Record<string, unknown> | undefined)?.equipment)} P:${yesNo((r.checklist as Record<string, unknown> | undefined)?.punctuality)} S:${yesNo((r.checklist as Record<string, unknown> | undefined)?.service)}`,
        [
          `Tipo: ${String(r.type || "—")}`,
          `Arma: ${String(r.weaponModel || "—")} / ${String(r.weaponSerial || "—")}`,
          `Lugar: ${String(r.lugar || "—")}`,
          `Justif: ${[
            (r.checklistReasons as Record<string, unknown> | undefined)?.uniform,
            (r.checklistReasons as Record<string, unknown> | undefined)?.equipment,
            (r.checklistReasons as Record<string, unknown> | undefined)?.punctuality,
            (r.checklistReasons as Record<string, unknown> | undefined)?.service,
          ].map((v) => String(v ?? "").trim()).filter(Boolean).join(" | ") || "—"}`,
          `Propiedad: luz ${String((r.propertyDetails as Record<string, unknown> | undefined)?.luz || "—")}, perimetro ${String((r.propertyDetails as Record<string, unknown> | undefined)?.perimetro || "—")}, sacate ${String((r.propertyDetails as Record<string, unknown> | undefined)?.sacate || "—")}`,
          `Daños: ${String((r.propertyDetails as Record<string, unknown> | undefined)?.danosPropiedad || "—")}`,
          `Evidencias: ${Array.isArray(r.photos) ? r.photos.length : 0}`,
          `Observaciones: ${String(r.observations || "—")}`,
        ].join("\n"),
      ])

      const result = await exportToPdf(
        "SUPERVISION AGRUPADA COMPLETA",
        ["FECHA/HORA", "OFICIAL", "OPERACIÓN/PUESTO", "ESTADO", "GPS", "CHECKLIST", "DETALLE"],
        rows,
        "HO_SUPERVISION_AGRUPADA_COMPLETA"
      )

      if (result.ok) toast({ title: "PDF descargado", description: "Detalle exportado correctamente." })
      else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
    } catch (error) {
      toast({
        title: "Error al exportar",
        description: error instanceof Error ? error.message : "No se pudo preparar la exportación.",
        variant: "destructive",
      })
    } finally {
      setIsExportingPdf(false)
    }
  }

  const handleExportRoundsExcel = async () => {
    if (isExportingExcel) return
    setIsExportingExcel(true)
    const { exportToExcel } = await import("@/lib/export-utils")
    try {
      const detailedRows = await fetchDetailedRoundRowsByIds(filteredRoundReports.map((row) => String(row.id ?? "")))
      const detailedById = new Map(detailedRows.map((row) => [String(row.id ?? ""), row]))
      const rows = filteredRoundReports.map((summaryRow) => {
        const r = detailedById.get(String(summaryRow.id ?? "")) ?? summaryRow
        const gps = getRoundGpsSummary(r)
        const details = getRoundOperationalSummary(r)
        return {
        codigoBoleta: getRoundReportCode(r),
        fechaHora: formatRoundDateTime(getRoundReportDate(r, "created")),
        inicio: formatRoundDateTime(getRoundReportDate(r, "started")),
        fin: formatRoundDateTime(getRoundReportDate(r, "ended")),
        ronda: String(r.roundName ?? "—"),
        puesto: String(r.postName ?? "—"),
        oficial: String(r.officerName ?? "—"),
        estado: String(r.status ?? "—"),
        checkpoints: `${Number(r.checkpointsCompleted ?? 0)}/${Number(r.checkpointsTotal ?? 0)}`,
        cumplimiento: getRoundCompletionLabel(r),
        preRonda: details.preRoundCondition,
        checklistPreRonda: details.checklist,
        notasPreRonda: details.preRoundNotes,
        distanciaKm: gps.distanceKm,
        duracion: gps.duration,
        gpsInicio: gps.gpsInicio,
        gpsFin: gps.gpsFin,
        resumenEventos: details.eventSummary,
        checkpointsCompletados: details.completed,
        checkpointsPendientes: details.pending,
        alertas: gps.alertas,
        contextoTurno: details.shiftContext,
        observaciones: String(r.notes ?? "—"),
        }
      })
      const result = await exportToExcel(rows, "Rondas", [
        { header: "CODIGO BOLETA", key: "codigoBoleta", width: 22 },
        { header: "FECHA/HORA", key: "fechaHora", width: 24 },
        { header: "INICIO", key: "inicio", width: 24 },
        { header: "FIN", key: "fin", width: 24 },
        { header: "RONDA", key: "ronda", width: 26 },
        { header: "PUESTO", key: "puesto", width: 24 },
        { header: "OFICIAL", key: "oficial", width: 22 },
        { header: "ESTADO", key: "estado", width: 14 },
        { header: "CHECKPOINTS", key: "checkpoints", width: 14 },
        { header: "CUMPLIMIENTO", key: "cumplimiento", width: 14 },
        { header: "PRE-RONDA", key: "preRonda", width: 16 },
        { header: "CHECKLIST PRE-RONDA", key: "checklistPreRonda", width: 34 },
        { header: "NOTAS PRE-RONDA", key: "notasPreRonda", width: 34 },
        { header: "DISTANCIA KM", key: "distanciaKm", width: 12 },
        { header: "DURACION", key: "duracion", width: 14 },
        { header: "GPS INICIO", key: "gpsInicio", width: 24 },
        { header: "GPS FIN", key: "gpsFin", width: 24 },
        { header: "RESUMEN EVENTOS", key: "resumenEventos", width: 36 },
        { header: "CHECKPOINTS COMPLETADOS", key: "checkpointsCompletados", width: 34 },
        { header: "CHECKPOINTS PENDIENTES", key: "checkpointsPendientes", width: 34 },
        { header: "ALERTAS", key: "alertas", width: 46 },
        { header: "CONTEXTO TURNO", key: "contextoTurno", width: 42 },
        { header: "OBSERVACIONES", key: "observaciones", width: 45 },
      ], "HO_RONDAS_FILTRADAS")
      if (result.ok) toast({ title: "Excel descargado", description: "Boletas de ronda exportadas correctamente." })
      else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
    } catch (error) {
      toast({ title: "Error al exportar", description: error instanceof Error ? error.message : "No se pudo generar Excel.", variant: "destructive" })
    } finally {
      setIsExportingExcel(false)
    }
  }

  const handleExportRoundsPdf = async () => {
    if (isExportingPdf) return
    setIsExportingPdf(true)
    const { exportToPdf } = await import("@/lib/export-utils")
    try {
      const detailedRows = await fetchDetailedRoundRowsByIds(filteredRoundReports.map((row) => String(row.id ?? "")))
      const detailedById = new Map(detailedRows.map((row) => [String(row.id ?? ""), row]))
      const rows = filteredRoundReports.map((summaryRow) => {
        const r = detailedById.get(String(summaryRow.id ?? "")) ?? summaryRow
        const gps = getRoundGpsSummary(r)
        const details = getRoundOperationalSummary(r)
        return [
          getRoundReportCode(r),
          [
            `Registro: ${formatRoundDateTime(getRoundReportDate(r, "created"))}`,
            `Inicio: ${formatRoundDateTime(getRoundReportDate(r, "started"))}`,
            `Fin: ${formatRoundDateTime(getRoundReportDate(r, "ended"))}`,
            `Estado: ${String(r.status ?? "—")}`,
            `Avance: ${Number(r.checkpointsCompleted ?? 0)}/${Number(r.checkpointsTotal ?? 0)}`,
            `Cumpl.: ${getRoundCompletionLabel(r)}`,
          ].join("\n"),
          [
            `Ronda: ${String(r.roundName ?? "—")}`,
            `Puesto: ${String(r.postName ?? "—")}`,
            `Oficial: ${String(r.officerName ?? "—")}`,
          ].join("\n"),
          [
            `Condicion: ${details.preRoundCondition}`,
            `Checklist: ${details.checklist}`,
            `Notas: ${details.preRoundNotes}`,
          ].join("\n"),
          [
            `GPS inicio: ${gps.gpsInicio}`,
            `GPS fin: ${gps.gpsFin}`,
            `KM: ${gps.distanceKm}`,
            `Duracion: ${gps.duration}`,
            details.eventSummary,
          ].join("\n"),
          [
            `Completados: ${details.completed}`,
            `Pendientes: ${details.pending}`,
          ].join("\n"),
          [
            gps.alertas,
            details.shiftContext,
          ].join("\n"),
          `Obs: ${String(r.notes ?? "—")}`,
        ]
      })
      const result = await exportToPdf(
        "BOLETAS DE RONDA",
        ["CODIGO", "FECHA / ESTADO", "OPERACION", "PRE-RONDA", "EJECUCION", "CHECKPOINTS", "ALERTAS / TURNO", "OBSERVACIONES"],
        rows,
        "HO_RONDAS_FILTRADAS"
      )
      if (result.ok) toast({ title: "PDF descargado", description: "Boletas de ronda exportadas correctamente." })
      else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
    } catch (error) {
      toast({ title: "Error al exportar", description: error instanceof Error ? error.message : "No se pudo generar PDF.", variant: "destructive" })
    } finally {
      setIsExportingPdf(false)
    }
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">SUPERVISION AGRUPADA</h1>
        <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
          Acceso rapido por puesto, supervisor, fecha y usuario para descarga inmediata.
        </p>
      </div>

      <Card className="bg-[#0c0c0c]/60 border-white/5">
        <CardContent className="p-4 flex flex-col md:flex-row md:items-end gap-3">
          <div className="space-y-1 w-full md:w-72">
            <Label className="text-[10px] uppercase font-black text-white/70">Ver modulo</Label>
            <Select value={viewMode} onValueChange={(v) => setViewMode(v as "SUPERVISIONES" | "RONDAS")}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SUPERVISIONES">Supervisiones</SelectItem>
                <SelectItem value="RONDAS">Rondas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <p className="text-[11px] text-white/60 uppercase font-bold">{viewMode === "SUPERVISIONES" ? "Usando filtros y export de supervisiones" : "Usando filtros y export de boletas de ronda"}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase font-black text-muted-foreground">Registros filtrados</p>
            <p className="text-3xl font-black text-white mt-1">{viewMode === "SUPERVISIONES" ? totalItems : totalBoletas}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase font-black text-muted-foreground">{viewMode === "SUPERVISIONES" ? "Grupos activos" : "Boletas completas"}</p>
            <p className="text-3xl font-black text-white mt-1">{viewMode === "SUPERVISIONES" ? totalGrupos : boletasCompletas}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase font-black text-muted-foreground">{viewMode === "SUPERVISIONES" ? "Boletas filtradas" : "Boletas parciales"}</p>
            <p className="text-3xl font-black text-white mt-1">{viewMode === "SUPERVISIONES" ? totalBoletas : Math.max(totalBoletas - boletasCompletas, 0)}</p>
            <p className="text-[10px] uppercase font-black text-white/60 mt-1">{viewMode === "SUPERVISIONES" ? `Completas: ${boletasCompletas}` : `Total: ${totalBoletas}`}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Filtros de acceso rapido</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Busqueda</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 bg-black/30 border-white/10" placeholder="Puesto, usuario, operacion..." />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Operacion</Label>
            <Select value={operacionFilter} onValueChange={setOperacionFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {activeOperaciones.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
            <Select value={puestoFilter} onValueChange={setPuestoFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {activePuestos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Dia</Label>
            <Select value={dayFilter} onValueChange={setDayFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                <SelectItem value="LUNES">LUNES</SelectItem>
                <SelectItem value="MARTES">MARTES</SelectItem>
                <SelectItem value="MIERCOLES">MIERCOLES</SelectItem>
                <SelectItem value="JUEVES">JUEVES</SelectItem>
                <SelectItem value="VIERNES">VIERNES</SelectItem>
                <SelectItem value="SABADO">SABADO</SelectItem>
                <SelectItem value="DOMINGO">DOMINGO</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Supervisor</Label>
            <Select value={supervisorFilter} onValueChange={setSupervisorFilter}>
              <SelectTrigger className="bg-black/30 border-white/10" disabled={viewMode === "RONDAS"}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {supervisores.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Usuario</Label>
            <Select value={usuarioFilter} onValueChange={setUsuarioFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {activeUsuarios.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Desde</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Hasta</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Hora desde</Label>
            <Input type="time" value={hourFrom} onChange={(e) => setHourFrom(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Hora hasta</Label>
            <Input type="time" value={hourTo} onChange={(e) => setHourTo(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="md:col-span-2 lg:col-span-3 flex items-end gap-2 flex-wrap">
            {viewMode === "SUPERVISIONES" ? (
              <>
                <Button onClick={handleExportGroupedExcel} className="bg-primary hover:bg-primary/90 text-black font-black uppercase h-10 gap-2">
                  {isExportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel Agrupado
                </Button>
                <Button onClick={handleExportDetailedPdf} variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase h-10 gap-2">
                  {isExportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF Detallado
                </Button>
              </>
            ) : (
              <>
                <Button onClick={handleExportRoundsExcel} className="bg-primary hover:bg-primary/90 text-black font-black uppercase h-10 gap-2">
                  {isExportingExcel ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />} Excel Rondas
                </Button>
                <Button onClick={handleExportRoundsPdf} variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase h-10 gap-2">
                  {isExportingPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileDown className="w-4 h-4" />} PDF Rondas
                </Button>
              </>
            )}
            <Button onClick={() => handleQrOpenChange(true)} variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase h-10 gap-2">
              <QrCode className="w-4 h-4" /> Lector QR
            </Button>
            <Button onClick={clearFilters} variant="ghost" className="text-white/80 hover:text-white font-black uppercase h-10 gap-2">
              <FilterX className="w-4 h-4" /> Limpiar filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={qrOpen} onOpenChange={handleQrOpenChange}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Lector QR</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Escanee un codigo para aplicar filtro rapido por puesto, usuario u operacion.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-black/40 overflow-hidden h-64 flex items-center justify-center relative">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] font-black uppercase">Iniciando camara...</span>
                </div>
              )}
              {isScanning && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 px-2 py-1 rounded">
                  <ScanLine className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-black uppercase text-primary">Escaneando</span>
                </div>
              )}
            </div>

            {scanError && <p className="text-[10px] text-red-400 font-bold uppercase">{scanError}</p>}
            {!qrSupported && <p className="text-[10px] text-amber-400 font-bold uppercase">Este navegador no soporta lectura QR por camara.</p>}

            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Entrada manual</Label>
              <Input
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="Pegue el contenido del QR"
                className="bg-black/30 border-white/10"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (qrInput.trim()) {
                  applyQrValue(qrInput)
                  handleQrOpenChange(false)
                }
              }}
              className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
            >
              Aplicar filtro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={groupDetailOpen}
        onOpenChange={(open) => {
          setGroupDetailOpen(open)
          if (!open) {
            setSelectedGroupKey(null)
            setSelectedGroupIndex(0)
          }
        }}
      >
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Detalle de agrupacion</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Revise cada supervision una por una dentro del grupo seleccionado.
            </DialogDescription>
          </DialogHeader>

          {!selectedDetail ? (
            <div className="py-8 text-center text-[11px] uppercase font-black text-white/40">Sin registros para mostrar.</div>
          ) : (
            <div className="space-y-4">
              {loadingDetailId === selectedDetail.id && !selectedDetailData ? (
                <div className="rounded border border-white/10 bg-black/30 p-3 flex items-center gap-2 text-[11px] text-white/70">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" /> Cargando detalle...
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/40 px-3 py-2">
                <p className="text-[10px] uppercase font-black text-white/60">
                  Registro {selectedGroupIndex + 1} de {selectedGroupItems.length}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedGroupIndex <= 0}
                    onClick={() => setSelectedGroupIndex((value) => Math.max(0, value - 1))}
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedGroupIndex >= selectedGroupItems.length - 1}
                    onClick={() => setSelectedGroupIndex((value) => Math.min(selectedGroupItems.length - 1, value + 1))}
                    className="border-white/20 text-white hover:bg-white/10"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
                <div className="rounded border border-white/10 bg-black/30 p-3 space-y-1">
                  <p><span className="text-white/50">Fecha/Hora:</span> {selectedDetailData?.createdAt?.toDate?.()?.toLocaleString?.() ?? selectedDetail.date}</p>
                  <p><span className="text-white/50">Operacion:</span> {selectedDetail.operacion}</p>
                  <p><span className="text-white/50">Tipo:</span> {String(selectedDetailData?.type ?? "—")}</p>
                  <p><span className="text-white/50">Estado:</span> {selectedDetail.status}</p>
                  <p><span className="text-white/50">Supervisor:</span> {selectedDetail.supervisor}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/30 p-3 space-y-1">
                  <p><span className="text-white/50">Oficial:</span> {selectedDetail.usuario}</p>
                  <p><span className="text-white/50">Cedula:</span> {String(selectedDetailData?.idNumber ?? "—")}</p>
                  <p><span className="text-white/50">Telefono:</span> {String(selectedDetailData?.officerPhone ?? "—")}</p>
                  <p><span className="text-white/50">Puesto:</span> {selectedDetail.puesto}</p>
                  <p><span className="text-white/50">Lugar:</span> {String(selectedDetailData?.lugar ?? "—")}</p>
                </div>
              </div>

              <div className="rounded border border-white/10 bg-black/30 p-3 text-[11px] space-y-1">
                <p>
                  <span className="text-white/50">Checklist:</span>{" "}
                  U:{(selectedDetailData?.checklist as Record<string, unknown> | undefined)?.uniform === true ? "SI" : "NO"} |{" "}
                  E:{(selectedDetailData?.checklist as Record<string, unknown> | undefined)?.equipment === true ? "SI" : "NO"} |{" "}
                  P:{(selectedDetailData?.checklist as Record<string, unknown> | undefined)?.punctuality === true ? "SI" : "NO"} |{" "}
                  S:{(selectedDetailData?.checklist as Record<string, unknown> | undefined)?.service === true ? "SI" : "NO"}
                </p>
                <p>
                  <span className="text-white/50">GPS:</span>{" "}
                  {typeof selectedDetailData?.gps?.lat === "number" && typeof selectedDetailData?.gps?.lng === "number"
                    ? `${selectedDetailData.gps.lat.toFixed(6)}, ${selectedDetailData.gps.lng.toFixed(6)}`
                    : "—"}
                </p>
                <p>
                  <span className="text-white/50">Observaciones:</span> {String(selectedDetailData?.observations ?? "—")}
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {viewMode === "SUPERVISIONES" ? (
      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Agrupacion por fecha, puesto y supervisor</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="md:hidden p-4 space-y-3">
            {isLoading ? (
              <div className="py-10 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              </div>
            ) : grouped.length === 0 ? (
              <div className="py-10 text-center text-[10px] uppercase font-black text-white/40">Sin resultados para los filtros seleccionados.</div>
            ) : (
              grouped.map((g, idx) => (
                <div key={`${g.date}-${g.puesto}-${g.supervisor}-${idx}`} className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 text-[10px] text-white/70 font-mono">
                    <span>{g.date}</span>
                    <span>{g.hour}</span>
                  </div>
                  <p className="text-[11px] font-black text-white uppercase">{g.puesto}</p>
                  <p className="text-[10px] text-white/80 uppercase">{g.operacion}</p>
                  <p className="text-[10px] text-white/70">Supervisor: {g.supervisor}</p>
                  <p className="text-[10px] text-white/60">Usuarios: {g.usuarios.join(", ")}</p>
                  <div className="flex items-center gap-3 text-[10px] font-black uppercase">
                    <span className="text-primary">Total {g.total}</span>
                    <span className="text-green-400">Cumplim {g.cumplim}</span>
                    <span className="text-red-400">Novedad {g.novedad}</span>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => openGroupDetail(g.key)}
                    className="h-8 w-full border-white/20 text-white hover:bg-white/10 text-[10px] uppercase font-black gap-1"
                  >
                    <Eye className="w-3.5 h-3.5" /> Ver una por una
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white/[0.03] border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Fecha</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Hora</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Dia</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Puesto</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Operacion</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Supervisor</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Usuarios</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Total</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Cumplim</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Novedad</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-right">Accion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : grouped.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-[10px] uppercase font-black text-white/40">Sin resultados para los filtros seleccionados.</td>
                  </tr>
                ) : (
                  grouped.map((g, idx) => (
                    <tr key={`${g.date}-${g.puesto}-${g.supervisor}-${idx}`} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-[11px] font-mono text-white/80">{g.date}</td>
                      <td className="px-4 py-3 text-[11px] font-mono text-white/80">{g.hour}</td>
                      <td className="px-4 py-3 text-[11px] text-white/80">{g.day}</td>
                      <td className="px-4 py-3 text-[11px] font-black text-white uppercase">{g.puesto}</td>
                      <td className="px-4 py-3 text-[11px] text-white/80 uppercase">{g.operacion}</td>
                      <td className="px-4 py-3 text-[11px] text-white/80">{g.supervisor}</td>
                      <td className="px-4 py-3 text-[11px] text-white/70">{g.usuarios.join(", ")}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-primary">{g.total}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-green-400">{g.cumplim}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-red-400">{g.novedad}</td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openGroupDetail(g.key)}
                          className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] uppercase font-black gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" /> Ver una por una
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      ) : null}

      {viewMode === "RONDAS" ? (
      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Historial de Boletas de Ronda</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="md:hidden p-4 space-y-3">
            {isLoadingRoundReports ? (
              <div className="py-10 text-center">
                <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
              </div>
            ) : filteredRoundReports.length === 0 ? (
              <div className="py-10 text-center text-[10px] uppercase font-black text-white/40">Sin boletas para los filtros seleccionados.</div>
            ) : (
              filteredRoundReports.map((row) => {
                const created = row.createdAt?.toDate?.()
                const dateText = created instanceof Date && !Number.isNaN(created.getTime())
                  ? created.toLocaleString()
                  : "Sin fecha"
                const completed = Number(row.checkpointsCompleted ?? 0)
                const total = Number(row.checkpointsTotal ?? 0)
                return (
                  <div key={row.id} className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2 text-[10px] text-white/70">
                      <span>{dateText}</span>
                      <span className={String(row.status ?? "").toUpperCase() === "COMPLETA" ? "text-green-400 font-black" : "text-amber-300 font-black"}>
                        {String(row.status ?? "PARCIAL")}
                      </span>
                    </div>
                    <p className="text-[11px] font-black text-white uppercase">{String(row.roundName ?? "SIN RONDA")}</p>
                    <p className="text-[10px] text-white/80 uppercase">Puesto: {String(row.postName ?? UNKNOWN)}</p>
                    <p className="text-[10px] text-white/70">Oficial: {String(row.officerName ?? UNKNOWN)}</p>
                    <p className="text-[10px] text-primary font-black uppercase">Checkpoints: {completed}/{total}</p>
                  </div>
                )
              })
            )}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white/[0.03] border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Fecha/Hora</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Ronda</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Puesto</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Oficial</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Checkpoints</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoadingRoundReports ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : filteredRoundReports.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-16 text-center text-[10px] uppercase font-black text-white/40">Sin boletas para los filtros seleccionados.</td>
                  </tr>
                ) : (
                  filteredRoundReports.map((row) => {
                    const created = row.createdAt?.toDate?.()
                    const dateText = created instanceof Date && !Number.isNaN(created.getTime())
                      ? created.toLocaleString()
                      : "Sin fecha"
                    const completed = Number(row.checkpointsCompleted ?? 0)
                    const total = Number(row.checkpointsTotal ?? 0)

                    return (
                      <tr key={row.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 text-[11px] text-white/80">{dateText}</td>
                        <td className="px-4 py-3 text-[11px] font-black text-white uppercase">{String(row.roundName ?? "SIN RONDA")}</td>
                        <td className="px-4 py-3 text-[11px] text-white/80 uppercase">{String(row.postName ?? UNKNOWN)}</td>
                        <td className="px-4 py-3 text-[11px] text-white/80">{String(row.officerName ?? UNKNOWN)}</td>
                        <td className="px-4 py-3 text-[11px] text-center font-black text-primary">{completed}/{total}</td>
                        <td className="px-4 py-3 text-[11px] text-center font-black">
                          <span className={String(row.status ?? "").toUpperCase() === "COMPLETA" ? "text-green-400" : "text-amber-300"}>
                            {String(row.status ?? "PARCIAL")}
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      ) : null}
    </div>
  )
}
