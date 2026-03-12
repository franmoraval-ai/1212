"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { TacticalMap } from "@/components/ui/tactical-map"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { useQrScanner } from "@/hooks/use-qr-scanner"
import { nowIso, toSnakeCaseKeys } from "@/lib/supabase-db"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { CheckCircle2, Circle, ClipboardCheck, Download, FileDown, FileSpreadsheet, Loader2, Plus, QrCode, ScanLine, Camera, X } from "lucide-react"
import { useSearchParams } from "next/navigation"

type RoundCheckpoint = {
  name?: string
  qrCodes?: string[]
  qr_codes?: string[]
  nfcCodes?: string[]
  nfc_codes?: string[]
  lat?: number
  lng?: number
}

type RoundRow = {
  id: string
  name?: string
  post?: string
  frequency?: string
  checkpoints?: RoundCheckpoint[]
}

type RoundReportRow = {
  id: string
  roundName?: string
  postName?: string
  officerId?: string
  officerName?: string
  supervisorName?: string
  supervisorId?: string
  status?: string
  notes?: string | null
  checkpointsTotal?: number
  checkpointsCompleted?: number
  createdAt?: { toDate?: () => Date }
  checkpointLogs?: unknown
  checkpoint_logs?: unknown
}

type CheckpointState = {
  id: string
  name: string
  qrCodes: string[]
  nfcCodes: string[]
  scanCodes: string[]
  lat: number | null
  lng: number | null
  completedAt: string | null
  completedByQr: string | null
}

type ScanEvent = {
  at: string
  qrValue: string
  type: "round_selected" | "checkpoint_match" | "checkpoint_unmatched"
  checkpointId?: string
  checkpointName?: string
  lat?: number
  lng?: number
  accuracy?: number
  geofenceDistanceMeters?: number
  geofenceInside?: boolean
  fraudFlag?: string | null
}

type GpsPoint = {
  lat: number
  lng: number
  accuracy: number
  speed: number | null
  recordedAt: string
  ts: number
}

type RoundAlertSummary = {
  noScanGaps: number
  gpsJumps: number
  lowGpsQuality: boolean
  messages: string[]
}

type RoundSecurityConfig = {
  geofenceRadiusMeters: number
  noScanGapMinutes: number
  maxJumpMeters: number
}

type RoundSecurityConfigRow = {
  id: string
  geofenceRadiusMeters?: number
  noScanGapMinutes?: number
  maxJumpMeters?: number
  updatedAt?: { toDate?: () => Date }
  updatedBy?: string
}

function normalizeRoundQr(value: string) {
  try {
    const parsed = JSON.parse(value) as { id?: string; name?: string; post?: string }
    if (!parsed?.id) return null
    return { id: String(parsed.id), name: String(parsed.name ?? ""), post: String(parsed.post ?? "") }
  } catch {
    return null
  }
}

function normalizeScanToken(value: string) {
  return String(value ?? "").trim().toLowerCase()
}

function decodeNfcTextRecord(data: DataView) {
  if (data.byteLength === 0) return ""
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const status = bytes[0] ?? 0
  const langLength = status & 0x3f
  const textBytes = bytes.slice(1 + langLength)
  return new TextDecoder("utf-8").decode(textBytes)
}

function extractNfcToken(payload: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) {
  const records = payload.message?.records ?? []
  for (const record of records) {
    if (!record?.data) continue
    if (record.recordType === "text") {
      const text = decodeNfcTextRecord(record.data).trim()
      if (text) return text
      continue
    }
    const raw = new TextDecoder("utf-8").decode(new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)).trim()
    if (raw) return raw
  }
  return String(payload.serialNumber ?? "").trim()
}

function isRoundReportsMissingTableError(message: string) {
  const m = String(message ?? "").toLowerCase()
  return (
    (m.includes("round_reports") && m.includes("schema cache")) ||
    m.includes("could not find the table 'public.round_reports'")
  )
}

function toInputDateLocal(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

function haversineDistanceMeters(a: Pick<GpsPoint, "lat" | "lng">, b: Pick<GpsPoint, "lat" | "lng">) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const r = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function formatDurationLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function buildTrackSvgPath(points: GpsPoint[], width: number, height: number) {
  if (points.length < 2) return ""
  const lats = points.map((p) => p.lat)
  const lngs = points.map((p) => p.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)
  const latRange = Math.max(maxLat - minLat, 0.00001)
  const lngRange = Math.max(maxLng - minLng, 0.00001)
  const pad = 8
  return points.map((p, idx) => {
    const x = pad + ((p.lng - minLng) / lngRange) * (width - pad * 2)
    const y = pad + (1 - (p.lat - minLat) / latRange) * (height - pad * 2)
    return `${idx === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`
  }).join(" ")
}

const DEFAULT_ROUND_SECURITY_CONFIG: RoundSecurityConfig = {
  geofenceRadiusMeters: 50,
  noScanGapMinutes: 10,
  maxJumpMeters: 120,
}

function loadRoundSecurityConfig(): RoundSecurityConfig {
  if (typeof window === "undefined") return DEFAULT_ROUND_SECURITY_CONFIG
  const raw = window.localStorage.getItem("ho_round_security_config_v1")
  if (!raw) return DEFAULT_ROUND_SECURITY_CONFIG
  try {
    const parsed = JSON.parse(raw) as Partial<RoundSecurityConfig>
    return {
      geofenceRadiusMeters: Number.isFinite(parsed.geofenceRadiusMeters)
        ? Math.max(20, Math.min(300, Number(parsed.geofenceRadiusMeters)))
        : DEFAULT_ROUND_SECURITY_CONFIG.geofenceRadiusMeters,
      noScanGapMinutes: Number.isFinite(parsed.noScanGapMinutes)
        ? Math.max(3, Math.min(30, Number(parsed.noScanGapMinutes)))
        : DEFAULT_ROUND_SECURITY_CONFIG.noScanGapMinutes,
      maxJumpMeters: Number.isFinite(parsed.maxJumpMeters)
        ? Math.max(60, Math.min(500, Number(parsed.maxJumpMeters)))
        : DEFAULT_ROUND_SECURITY_CONFIG.maxJumpMeters,
    }
  } catch {
    return DEFAULT_ROUND_SECURITY_CONFIG
  }
}

function getTrackFromUnknownLogs(logs: unknown): GpsPoint[] {
  if (!logs || typeof logs !== "object") return []
  const maybe = logs as { gpsTrack?: unknown; gps_track?: unknown }
  const raw = Array.isArray(maybe.gpsTrack) ? maybe.gpsTrack : Array.isArray(maybe.gps_track) ? maybe.gps_track : []
  return raw.map((item) => {
    const row = item as Partial<GpsPoint>
    const lat = Number(row.lat)
    const lng = Number(row.lng)
    const accuracy = Number(row.accuracy)
    const speed = typeof row.speed === "number" ? row.speed : null
    const ts = Number(row.ts)
    const recordedAt = String(row.recordedAt ?? row.recordedAt ?? "")
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      lat,
      lng,
      accuracy: Number.isFinite(accuracy) ? accuracy : 0,
      speed,
      ts: Number.isFinite(ts) ? ts : 0,
      recordedAt,
    }
  }).filter((v): v is GpsPoint => v !== null)
}

function getReportTrack(report: RoundReportRow): GpsPoint[] {
  return getTrackFromUnknownLogs(report.checkpointLogs ?? report.checkpoint_logs)
}

function buildGpxXml(points: GpsPoint[], name: string) {
  const esc = (v: string) => v.replace(/[<>&"']/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[m] ?? m))
  const trkpts = points.map((p) => {
    const iso = p.recordedAt || new Date(p.ts || Date.now()).toISOString()
    return `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${esc(iso)}</time></trkpt>`
  }).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="HO-Seguridad" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`
}

function getScanTimesMs(events: ScanEvent[]) {
  return events
    .map((e) => new Date(e.at).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
}

function computeRoundAlerts(
  gpsPoints: GpsPoint[],
  events: ScanEvent[],
  startedIso: string,
  endedIso: string,
  cfg: RoundSecurityConfig
): RoundAlertSummary {
  let noScanGaps = 0
  let gpsJumps = 0
  const messages: string[] = []

  const startMs = new Date(startedIso).getTime()
  const endMs = new Date(endedIso).getTime()
  const scanTimes = getScanTimesMs(events)
  const anchors = [startMs, ...scanTimes, endMs].filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  for (let i = 1; i < anchors.length; i += 1) {
    const gapMs = anchors[i] - anchors[i - 1]
    if (gapMs > cfg.noScanGapMinutes * 60 * 1000) noScanGaps += 1
  }

  for (let i = 1; i < gpsPoints.length; i += 1) {
    const prev = gpsPoints[i - 1]
    const curr = gpsPoints[i]
    const dt = Math.max(1, curr.ts - prev.ts)
    const dist = haversineDistanceMeters(prev, curr)
    const speedMs = dist / (dt / 1000)
    if (dist > cfg.maxJumpMeters && speedMs > 6) gpsJumps += 1
  }

  const badAccuracyPoints = gpsPoints.filter((p) => p.accuracy > 35).length
  const lowGpsQuality = gpsPoints.length > 0 && badAccuracyPoints / gpsPoints.length > 0.35
  const offGeofenceScans = events.filter((e) => e.fraudFlag === "scan_outside_geofence").length
  const manualValidations = events.filter((e) => e.qrValue === "manual").length
  const unmatchedScans = events.filter((e) => e.type === "checkpoint_unmatched").length

  if (noScanGaps > 0) messages.push(`${noScanGaps} brecha(s) > ${cfg.noScanGapMinutes} min sin escaneo QR/NFC`)
  if (gpsJumps > 0) messages.push(`${gpsJumps} salto(s) de recorrido detectado(s)`)
  if (lowGpsQuality) messages.push("GPS con precision baja en buena parte de la ronda")
  if (offGeofenceScans > 0) messages.push(`${offGeofenceScans} escaneo(s) fuera del radio geofence`)
  if (manualValidations > 0) messages.push(`${manualValidations} checkpoint(s) validados manualmente`)
  if (unmatchedScans >= 3) messages.push(`${unmatchedScans} intentos de codigo no reconocido`)

  return { noScanGaps, gpsJumps, lowGpsQuality, messages }
}

function getStoredAlertMessages(report: RoundReportRow) {
  const logs = report.checkpointLogs ?? report.checkpoint_logs
  if (!logs || typeof logs !== "object") return [] as string[]
  const candidate = (logs as { alerts?: unknown }).alerts
  if (!candidate || typeof candidate !== "object") return []
  const messages = (candidate as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages.map((m) => String(m)) : []
}

function getReportCreatedDate(report: RoundReportRow) {
  const date = report.createdAt?.toDate?.()
  return date && !Number.isNaN(date.getTime()) ? date : null
}

function getRoundReportCode(report: RoundReportRow) {
  const date = getReportCreatedDate(report) ?? new Date()
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}${m}${d}-${String(report.id).slice(0, 8)}`
}

function getRoundLogDetails(report: RoundReportRow) {
  const source = report.checkpointLogs ?? report.checkpoint_logs
  if (!source || typeof source !== "object") {
    return {
      preRoundCondition: "-",
      preRoundNotes: "-",
      distanceKm: "-",
      duration: "-",
      evidenceCount: 0,
      eventsCount: 0,
    }
  }

  const logs = source as {
    pre_round?: { condition?: string; notes?: string | null }
    gps_distance_meters?: number
    elapsed_seconds?: number
    photos?: unknown
    events?: unknown
  }

  return {
    preRoundCondition: String(logs.pre_round?.condition ?? "-"),
    preRoundNotes: String(logs.pre_round?.notes ?? "-") || "-",
    distanceKm: Number.isFinite(Number(logs.gps_distance_meters)) ? (Number(logs.gps_distance_meters) / 1000).toFixed(2) : "-",
    duration: Number.isFinite(Number(logs.elapsed_seconds)) ? formatDurationLabel(Number(logs.elapsed_seconds)) : "-",
    evidenceCount: Array.isArray(logs.photos) ? logs.photos.length : 0,
    eventsCount: Array.isArray(logs.events) ? logs.events.length : 0,
  }
}

export default function RoundBulletinPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const prefillRoundId = String(searchParams.get("roundId") ?? "").trim()

  const [activeRoundId, setActiveRoundId] = useState<string>(prefillRoundId)
  const [notes, setNotes] = useState("")
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [checkpointState, setCheckpointState] = useState<CheckpointState[]>([])
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([])
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [preRoundCondition, setPreRoundCondition] = useState("NORMAL")
  const [preRoundNotes, setPreRoundNotes] = useState("")
  const [checkDoorsClosed, setCheckDoorsClosed] = useState(true)
  const [checkLightsOk, setCheckLightsOk] = useState(true)
  const [checkPerimeterOk, setCheckPerimeterOk] = useState(true)
  const [checkNoStrangers, setCheckNoStrangers] = useState(true)
  const [pendingStartByQr, setPendingStartByQr] = useState(false)
  const [startQrValidated, setStartQrValidated] = useState(false)
  const [gpsTrack, setGpsTrack] = useState<GpsPoint[]>([])
  const [distanceMeters, setDistanceMeters] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [historyDateFromFilter, setHistoryDateFromFilter] = useState("")
  const [historyDateToFilter, setHistoryDateToFilter] = useState("")
  const [historyHourFilter, setHistoryHourFilter] = useState("")
  const [historyOperationFilter, setHistoryOperationFilter] = useState("")
  const [historyLocationFilter, setHistoryLocationFilter] = useState("")
  const [historySupervisorFilter, setHistorySupervisorFilter] = useState("")
  const [historyTrackOpen, setHistoryTrackOpen] = useState(false)
  const [historyTrackReport, setHistoryTrackReport] = useState<RoundReportRow | null>(null)
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false)
  const [historyDetailReport, setHistoryDetailReport] = useState<RoundReportRow | null>(null)
  const [historyEditOpen, setHistoryEditOpen] = useState(false)
  const [historyEditId, setHistoryEditId] = useState("")
  const [historyEditRoundName, setHistoryEditRoundName] = useState("")
  const [historyEditPostName, setHistoryEditPostName] = useState("")
  const [historyEditOfficerName, setHistoryEditOfficerName] = useState("")
  const [historyEditSupervisorName, setHistoryEditSupervisorName] = useState("")
  const [historyEditStatus, setHistoryEditStatus] = useState("COMPLETA")
  const [historyEditNotes, setHistoryEditNotes] = useState("")
  const [isSavingHistoryEdit, setIsSavingHistoryEdit] = useState(false)
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(() => loadRoundSecurityConfig().geofenceRadiusMeters)
  const [noScanGapMinutes, setNoScanGapMinutes] = useState(() => loadRoundSecurityConfig().noScanGapMinutes)
  const [maxJumpMeters, setMaxJumpMeters] = useState(() => loadRoundSecurityConfig().maxJumpMeters)
  const [isSavingSecurityConfig, setIsSavingSecurityConfig] = useState(false)

  const [qrOpen, setQrOpen] = useState(false)
  const [qrInput, setQrInput] = useState("")
  const [isNfcScanning, setIsNfcScanning] = useState(false)
  const [nfcSupported] = useState(() => typeof window !== "undefined" && "NDEFReader" in window)
  const nfcAbortRef = useRef<AbortController | null>(null)
  const photoInputRef = useRef<HTMLInputElement | null>(null)
  const gpsWatchIdRef = useRef<number | null>(null)
  const latestGpsPointRef = useRef<GpsPoint | null>(null)
  const isStartingSessionRef = useRef(false)

  const { data: roundsData, isLoading: roundsLoading } = useCollection<RoundRow>(
    user ? "rounds" : null,
    { orderBy: "name", orderDesc: false }
  )
  const { data: reportsData, isLoading: reportsLoading } = useCollection<RoundReportRow>(
    user ? "round_reports" : null,
    { orderBy: "created_at", orderDesc: true }
  )
  const { data: securityConfigRows, error: securityConfigError } = useCollection<RoundSecurityConfigRow>(
    user ? "round_security_config" : null,
    { orderBy: "updated_at", orderDesc: true, realtime: false, pollingMs: 120000 }
  )

  const rounds = useMemo(() => roundsData ?? [], [roundsData])
  const reports = useMemo(() => reportsData ?? [], [reportsData])
  const roleLevel = Number(user?.roleLevel ?? 1)
  const isL1Operator = roleLevel <= 1
  const canEditFraudConfig = (user?.roleLevel ?? 1) >= 4
  const canManualCheckpointValidation = (user?.roleLevel ?? 1) >= 4
  const canEditRoundReports = (user?.roleLevel ?? 1) >= 4

  const scopedReports = useMemo(() => {
    if (roleLevel >= 2) return reports

    const uid = String(user?.uid ?? "").trim().toLowerCase()
    const email = String(user?.email ?? "").trim().toLowerCase()
    const firstName = String(user?.firstName ?? "").trim().toLowerCase()
    const emailAlias = email.includes("@") ? email.split("@")[0] : email

    const belongsToCurrentUser = (report: RoundReportRow) => {
      const officerId = String(report.officerId ?? "").trim().toLowerCase()
      const officerName = String(report.officerName ?? "").trim().toLowerCase()
      return (
        (!!officerId && (officerId === uid || officerId === email)) ||
        (!!officerName && (officerName.includes(firstName) || officerName.includes(emailAlias)))
      )
    }

    return reports.filter((report) => belongsToCurrentUser(report))
  }, [reports, roleLevel, user])

  const localDraftSecurityConfig = useMemo<RoundSecurityConfig>(() => ({
    geofenceRadiusMeters,
    noScanGapMinutes,
    maxJumpMeters,
  }), [geofenceRadiusMeters, noScanGapMinutes, maxJumpMeters])

  const serverSecurityConfig = useMemo<RoundSecurityConfig | null>(() => {
    const row = (securityConfigRows ?? [])[0]
    if (!row) return null
    const geofence = Number(row.geofenceRadiusMeters)
    const noScan = Number(row.noScanGapMinutes)
    const jump = Number(row.maxJumpMeters)
    if (!Number.isFinite(geofence) || !Number.isFinite(noScan) || !Number.isFinite(jump)) return null
    return {
      geofenceRadiusMeters: Math.max(20, Math.min(300, geofence)),
      noScanGapMinutes: Math.max(3, Math.min(30, noScan)),
      maxJumpMeters: Math.max(60, Math.min(500, jump)),
    }
  }, [securityConfigRows])

  const securityConfig = useMemo<RoundSecurityConfig>(() => {
    if (canEditFraudConfig) return localDraftSecurityConfig
    return serverSecurityConfig ?? localDraftSecurityConfig
  }, [canEditFraudConfig, localDraftSecurityConfig, serverSecurityConfig])

  const activeRound = useMemo(
    () => rounds.find((r) => String(r.id) === activeRoundId) ?? null,
    [rounds, activeRoundId]
  )

  const buildCheckpointState = useCallback((round: RoundRow | null) => {
    if (!round) return [] as CheckpointState[]

    return ((round.checkpoints ?? []) as RoundCheckpoint[]).map((cp, index) => {
      const qrCodes = [...(cp.qrCodes ?? []), ...(cp.qr_codes ?? [])].map((value) => String(value).trim()).filter(Boolean)
      const nfcCodes = [...(cp.nfcCodes ?? []), ...(cp.nfc_codes ?? [])].map((value) => String(value).trim()).filter(Boolean)
      return {
        id: `cp-${index + 1}`,
        name: String(cp.name ?? `Punto ${index + 1}`),
        qrCodes,
        nfcCodes,
        scanCodes: Array.from(new Set([...qrCodes, ...nfcCodes])),
        lat: Number.isFinite(Number(cp.lat)) ? Number(cp.lat) : null,
        lng: Number.isFinite(Number(cp.lng)) ? Number(cp.lng) : null,
        completedAt: null,
        completedByQr: null,
      }
    })
  }, [])

  const handleRoundChange = useCallback((roundId: string) => {
    const nextRound = rounds.find((round) => String(round.id) === roundId) ?? null
    setActiveRoundId(roundId)
    setCheckpointState(buildCheckpointState(nextRound))
    setStartedAt(null)
    setPendingStartByQr(false)
    setStartQrValidated(false)
    setActiveSessionId(null)
    setGpsTrack([])
    setDistanceMeters(0)
    setElapsedSeconds(0)
    setGpsError(null)
    latestGpsPointRef.current = null
    setScanEvents([])
  }, [rounds, buildCheckpointState])

  const completedCount = checkpointState.filter((cp) => cp.completedAt).length
  const totalCount = checkpointState.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

  const filteredReports = useMemo(() => {
    const operationNeedle = historyOperationFilter.trim().toLowerCase()
    const locationNeedle = historyLocationFilter.trim().toLowerCase()
    const supervisorNeedle = historySupervisorFilter.trim().toLowerCase()
    const hourNeedle = historyHourFilter.trim()

    return scopedReports.filter((report) => {
      const date = report.createdAt?.toDate?.()
      const dateKey = date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : ""
      const hourKey = date && !Number.isNaN(date.getTime())
        ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
        : ""
      const operationValue = String(report.roundName ?? "").toLowerCase()
      const locationValue = String(report.postName ?? "").toLowerCase()
      const supervisorValue = [
        String(report.supervisorName ?? "").toLowerCase(),
        String(report.supervisorId ?? "").toLowerCase(),
        String(report.officerName ?? "").toLowerCase(),
      ].join(" ")

      if (historyDateFromFilter && dateKey && dateKey < historyDateFromFilter) return false
      if (historyDateFromFilter && !dateKey) return false
      if (historyDateToFilter && dateKey && dateKey > historyDateToFilter) return false
      if (historyDateToFilter && !dateKey) return false
      if (hourNeedle && !hourKey.includes(hourNeedle)) return false
      if (operationNeedle && !operationValue.includes(operationNeedle)) return false
      if (locationNeedle && !locationValue.includes(locationNeedle)) return false
      if (supervisorNeedle && !supervisorValue.includes(supervisorNeedle)) return false
      return true
    })
  }, [
    scopedReports,
    historyDateFromFilter,
    historyDateToFilter,
    historyHourFilter,
    historyOperationFilter,
    historyLocationFilter,
    historySupervisorFilter,
  ])

  const applyQuickRange = useCallback((days: number) => {
    const today = new Date()
    const end = toInputDateLocal(today)
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - (days - 1))
    const start = toInputDateLocal(startDate)
    setHistoryDateFromFilter(start)
    setHistoryDateToFilter(end)
  }, [])

  const trackPath = useMemo(() => buildTrackSvgPath(gpsTrack, 340, 140), [gpsTrack])
  const distanceKm = useMemo(() => distanceMeters / 1000, [distanceMeters])
  const latestGpsPoint = useMemo(() => gpsTrack[gpsTrack.length - 1] ?? null, [gpsTrack])
  const historyTrack = useMemo(() => (historyTrackReport ? getReportTrack(historyTrackReport) : []), [historyTrackReport])
  const historyTrackPath = useMemo(() => buildTrackSvgPath(historyTrack, 520, 220), [historyTrack])
  const historyMapCenter = useMemo<[number, number]>(() => {
    if (historyTrack.length === 0) return [-84.0907, 9.9281]
    const lat = historyTrack.reduce((sum, p) => sum + p.lat, 0) / historyTrack.length
    const lng = historyTrack.reduce((sum, p) => sum + p.lng, 0) / historyTrack.length
    return [lng, lat]
  }, [historyTrack])
  const historyMapMarkers = useMemo(() => {
    if (historyTrack.length === 0) return [] as Array<{ lng: number; lat: number; color?: string; title?: string }>
    const first = historyTrack[0]
    const last = historyTrack[historyTrack.length - 1]
    return [
      { lng: first.lng, lat: first.lat, color: "#22c55e", title: "Inicio" },
      { lng: last.lng, lat: last.lat, color: "#f97316", title: "Fin" },
    ]
  }, [historyTrack])

  const recentFraudNotifications = useMemo(() => {
    return scopedReports
      .map((r) => {
        const messages = getStoredAlertMessages(r)
        if (messages.length === 0) return null
        return {
          id: r.id,
          at: r.createdAt?.toDate?.() ?? null,
          roundName: String(r.roundName ?? "Ronda"),
          officerName: String(r.officerName ?? "Oficial"),
          messages,
        }
      })
      .filter((v): v is { id: string; at: Date | null; roundName: string; officerName: string; messages: string[] } => v !== null)
      .slice(0, 5)
  }, [scopedReports])

  const downloadGpxFromReport = useCallback((report: RoundReportRow) => {
    const points = getReportTrack(report)
    if (points.length < 2) {
      toast({ title: "Sin trazado GPX", description: "Esta boleta no tiene suficientes puntos GPS.", variant: "destructive" })
      return
    }
    const baseDate = report.createdAt?.toDate?.() ?? new Date()
    const code = `${baseDate.getFullYear()}${String(baseDate.getMonth() + 1).padStart(2, "0")}${String(baseDate.getDate()).padStart(2, "0")}`
    const name = `Ronda ${String(report.roundName ?? "SinNombre")} ${code}`
    const xml = buildGpxXml(points, name)
    const blob = new Blob([xml], { type: "application/gpx+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gpx-ronda-${String(report.id).slice(0, 8)}.gpx`
    a.click()
    URL.revokeObjectURL(url)
  }, [toast])

  const handleExportSingleExcel = useCallback(async (report: RoundReportRow) => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const reportDate = getReportCreatedDate(report)
    const alertMessages = getStoredAlertMessages(report)
    const logSource = report.checkpointLogs ?? report.checkpoint_logs
    const logs = (logSource && typeof logSource === "object") ? logSource as {
      pre_round?: { condition?: string; notes?: string | null }
      gps_distance_meters?: number
      elapsed_seconds?: number
      photos?: unknown
    } : null

    const row = {
      codigo: getRoundReportCode(report),
      fecha: reportDate?.toLocaleDateString?.() ?? "-",
      hora: reportDate?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-",
      ronda: String(report.roundName ?? "-"),
      lugar: String(report.postName ?? "-"),
      oficial: String(report.officerName ?? "-"),
      supervisor: String(report.supervisorName ?? report.supervisorId ?? report.officerName ?? "-"),
      estado: String(report.status ?? "-"),
      avance: `${Number(report.checkpointsCompleted ?? 0)}/${Number(report.checkpointsTotal ?? 0)}`,
      preRonda: String(logs?.pre_round?.condition ?? "-"),
      distanciaKm: Number.isFinite(Number(logs?.gps_distance_meters))
        ? (Number(logs?.gps_distance_meters) / 1000).toFixed(2)
        : "-",
      duracion: Number.isFinite(Number(logs?.elapsed_seconds))
        ? formatDurationLabel(Number(logs?.elapsed_seconds))
        : "-",
      evidencias: Array.isArray(logs?.photos) ? logs?.photos.length : 0,
      alertas: alertMessages.length ? alertMessages.join(" | ") : "Sin alertas",
    }

    const result = await exportToExcel(
      [row],
      "Boleta Ronda",
      [
        { header: "CODIGO", key: "codigo", width: 20 },
        { header: "FECHA", key: "fecha", width: 14 },
        { header: "HORA", key: "hora", width: 10 },
        { header: "RONDA", key: "ronda", width: 24 },
        { header: "LUGAR", key: "lugar", width: 20 },
        { header: "OFICIAL", key: "oficial", width: 20 },
        { header: "SUPERVISOR", key: "supervisor", width: 20 },
        { header: "ESTADO", key: "estado", width: 12 },
        { header: "AVANCE", key: "avance", width: 12 },
        { header: "PRE-RONDA", key: "preRonda", width: 14 },
        { header: "DISTANCIA KM", key: "distanciaKm", width: 14 },
        { header: "DURACION", key: "duracion", width: 12 },
        { header: "EVIDENCIAS", key: "evidencias", width: 12 },
        { header: "ALERTAS", key: "alertas", width: 50 },
      ],
      `HO_BOLETA_RONDA_${getRoundReportCode(report)}`
    )

    if (result.ok) toast({ title: "Excel individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }, [toast])

  const handleExportSinglePdf = useCallback(async (report: RoundReportRow) => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const reportDate = getReportCreatedDate(report)
    const alertMessages = getStoredAlertMessages(report)
    const logs = ((report.checkpointLogs ?? report.checkpoint_logs) && typeof (report.checkpointLogs ?? report.checkpoint_logs) === "object")
      ? (report.checkpointLogs ?? report.checkpoint_logs) as {
        pre_round?: { condition?: string }
        gps_distance_meters?: number
        elapsed_seconds?: number
        photos?: unknown
      }
      : null

    const rows: (string | number)[][] = [[
      getRoundReportCode(report),
      reportDate?.toLocaleDateString?.() ?? "-",
      reportDate?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-",
      String(report.roundName ?? "-"),
      String(report.postName ?? "-"),
      String(report.officerName ?? "-"),
      String(report.status ?? "-"),
      `${Number(report.checkpointsCompleted ?? 0)}/${Number(report.checkpointsTotal ?? 0)}`,
      String(logs?.pre_round?.condition ?? "-"),
      Number.isFinite(Number(logs?.gps_distance_meters)) ? (Number(logs?.gps_distance_meters) / 1000).toFixed(2) : "-",
      Number.isFinite(Number(logs?.elapsed_seconds)) ? formatDurationLabel(Number(logs?.elapsed_seconds)) : "-",
      Array.isArray(logs?.photos) ? logs?.photos.length : 0,
      alertMessages.length,
    ]]

    const result = await exportToPdf(
      "BOLETA DE RONDA - INDIVIDUAL",
      ["CODIGO", "FECHA", "HORA", "RONDA", "LUGAR", "OFICIAL", "ESTADO", "AVANCE", "PRE-RONDA", "KM", "DURACION", "EVID", "ALERTAS"],
      rows,
      `HO_BOLETA_RONDA_${getRoundReportCode(report)}`
    )

    if (result.ok) toast({ title: "PDF individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }, [toast])

  const handleOpenRoundDetail = useCallback((report: RoundReportRow) => {
    setHistoryDetailReport(report)
    setHistoryDetailOpen(true)
  }, [])

  const handleOpenRoundEdit = useCallback((report: RoundReportRow) => {
    if (!canEditRoundReports) return
    setHistoryEditId(String(report.id))
    setHistoryEditRoundName(String(report.roundName ?? ""))
    setHistoryEditPostName(String(report.postName ?? ""))
    setHistoryEditOfficerName(String(report.officerName ?? ""))
    setHistoryEditSupervisorName(String(report.supervisorName ?? report.supervisorId ?? ""))
    const rawStatus = String(report.status ?? "COMPLETA").toUpperCase()
    setHistoryEditStatus(rawStatus.includes("PARC") ? "PARCIAL" : "COMPLETA")
    setHistoryEditNotes(String(report.notes ?? ""))
    setHistoryEditOpen(true)
  }, [canEditRoundReports])

  const handleSaveRoundEdit = useCallback(async () => {
    if (!canEditRoundReports || !historyEditId) return

    setIsSavingHistoryEdit(true)
    const payload = toSnakeCaseKeys({
      roundName: historyEditRoundName.trim() || null,
      postName: historyEditPostName.trim() || null,
      officerName: historyEditOfficerName.trim() || null,
      supervisorName: historyEditSupervisorName.trim() || null,
      status: historyEditStatus,
      notes: historyEditNotes.trim() || null,
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, {
      table: "round_reports",
      action: "update",
      payload,
      match: { id: historyEditId },
    })
    setIsSavingHistoryEdit(false)

    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Edicion en cola" : "Boleta actualizada",
      description: result.queued
        ? "Sin conexion: la actualizacion se sincronizara al reconectar."
        : "Cambios aplicados correctamente.",
    })
    setHistoryEditOpen(false)
  }, [canEditRoundReports, historyEditId, historyEditNotes, historyEditOfficerName, historyEditPostName, historyEditRoundName, historyEditStatus, historyEditSupervisorName, supabase, toast])

  const handleSaveSecurityConfig = useCallback(async () => {
    if (!canEditFraudConfig || !user) return
    setIsSavingSecurityConfig(true)
    const payload = {
      id: "global",
      geofence_radius_meters: localDraftSecurityConfig.geofenceRadiusMeters,
      no_scan_gap_minutes: localDraftSecurityConfig.noScanGapMinutes,
      max_jump_meters: localDraftSecurityConfig.maxJumpMeters,
      updated_by: user.email ?? user.uid,
      updated_at: nowIso(),
    }
    const { error } = await supabase.from("round_security_config").upsert(payload)
    setIsSavingSecurityConfig(false)
    if (error) {
      const detail = String(error.message ?? "").trim()
      toast({
        title: "No se pudo guardar config",
        description: detail
          ? `Error Supabase: ${detail}`
          : "Verifique tabla round_security_config. Ejecute supabase/create_round_security_config.sql.",
        variant: "destructive",
      })
      return
    }
    toast({ title: "Config guardada", description: "Geofencing y antifraude actualizados para todos los dispositivos." })
  }, [canEditFraudConfig, localDraftSecurityConfig, supabase, toast, user])

  useEffect(() => {
    if (typeof window === "undefined") return
    const payload = JSON.stringify(localDraftSecurityConfig)
    window.localStorage.setItem("ho_round_security_config_v1", payload)
  }, [localDraftSecurityConfig])

  const stopNfcScan = useCallback(() => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort()
      nfcAbortRef.current = null
    }
    setIsNfcScanning(false)
  }, [])

  useEffect(() => {
    return () => {
      stopNfcScan()
    }
  }, [stopNfcScan])

  const applyScannedValueRef = useRef<(rawValue: string) => void>(() => {})
  const sendRoundEventForSessionRef = useRef<(sessionId: string, event: ScanEvent, token?: string) => Promise<void>>(async () => {})
  const startRoundSessionRef = useRef<(startedIso: string) => Promise<string | null>>(async () => null)
  const { videoRef, isScanning, scanError, qrSupported, startScanner, stopScanner } = useQrScanner({
    onDetected: (rawValue) => applyScannedValueRef.current(rawValue),
    autoStopOnDetected: false,
    errorNoCamera: "Este navegador no permite acceso a camara.",
    errorCameraStart: "No se pudo iniciar la camara. Revise permisos.",
  })

  const applyScannedValue = useCallback((rawValue: string) => {
    const clean = rawValue.trim()
    if (!clean) return
    const normalized = normalizeScanToken(clean)
    const firstCheckpoint = checkpointState[0]
    const matchesFirstCheckpoint = !!firstCheckpoint?.scanCodes.some((code) => normalizeScanToken(code) === normalized)

    if ((pendingStartByQr && activeRound) || (!startedAt && activeRound && matchesFirstCheckpoint)) {
      const required = firstCheckpoint
      if (!matchesFirstCheckpoint) {
        toast({ title: "Codigo de inicio invalido", description: "Debe escanear el primer codigo QR/NFC asignado de la ronda.", variant: "destructive" })
        return
      }

      const at = nowIso()
      setStartedAt(at)
      setStartQrValidated(true)
      setPendingStartByQr(false)
      setCheckpointState((prev) => prev.map((cp, idx) => idx === 0 ? { ...cp, completedAt: cp.completedAt ?? at, completedByQr: cp.completedByQr ?? clean } : cp))
      const gps = latestGpsPointRef.current
      const event: ScanEvent = {
        at,
        qrValue: clean,
        type: "checkpoint_match" as const,
        checkpointId: required?.id,
        checkpointName: required?.name,
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
        geofenceDistanceMeters: (required && gps && typeof required.lat === "number" && typeof required.lng === "number")
          ? Math.round(haversineDistanceMeters({ lat: required.lat, lng: required.lng }, gps))
          : undefined,
      }
      setScanEvents((prev) => [event, ...prev].slice(0, 30))
      void (async () => {
        const sessionId = (await startRoundSessionRef.current(at)) ?? activeSessionId
        if (sessionId) {
          await sendRoundEventForSessionRef.current(sessionId, event, clean)
        }
      })()
      toast({
        title: "Ronda iniciada",
        description: pendingStartByQr
          ? "QR de arranque validado y primer punto marcado."
          : "Inicio rapido aplicado: primer checkpoint validado.",
      })
      stopScanner()
      setQrOpen(false)
      return
    }

    const roundFromQr = normalizeRoundQr(clean)
    if (roundFromQr) {
      const exists = rounds.find((r) => String(r.id) === roundFromQr.id)
      if (exists) {
        setActiveRoundId(roundFromQr.id)
        setScanEvents((prev) => [{ at: nowIso(), qrValue: clean, type: "round_selected" as const }, ...prev].slice(0, 30))
        toast({ title: "Ronda cargada", description: `${roundFromQr.name || "Ronda"} lista para boleta.` })
        return
      }
    }

    if (!startedAt) {
      toast({ title: "Inicie la boleta", description: "Seleccione ronda y pulse INICIAR antes de escanear checkpoints.", variant: "destructive" })
      return
    }

    const matchIndex = checkpointState.findIndex(
      (cp) => !cp.completedAt && cp.scanCodes.some((code) => normalizeScanToken(code) === normalized)
    )

    if (matchIndex < 0) {
      const gps = latestGpsPointRef.current
      const event: ScanEvent = {
        at: nowIso(),
        qrValue: clean,
        type: "checkpoint_unmatched" as const,
        checkpointId: "unmatched",
        checkpointName: "No reconocido",
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
      }
      setScanEvents((prev) => [event, ...prev].slice(0, 30))
      if (activeSessionId) {
        void sendRoundEventForSessionRef.current(activeSessionId, event, clean)
      }
      toast({ title: "Codigo no reconocido", description: "No coincide con checkpoints pendientes de la ronda.", variant: "destructive" })
      return
    }

    const matched = checkpointState[matchIndex]
    const at = nowIso()
    const gps = latestGpsPointRef.current
    const geofenceDistance = (gps && typeof matched.lat === "number" && typeof matched.lng === "number")
      ? Math.round(haversineDistanceMeters({ lat: matched.lat, lng: matched.lng }, gps))
      : null
    const outsideGeofence = typeof geofenceDistance === "number" && geofenceDistance > geofenceRadiusMeters

    if (!outsideGeofence) {
      setCheckpointState((prev) => prev.map((cp, idx) => idx === matchIndex ? { ...cp, completedAt: at, completedByQr: clean } : cp))
    }

    const event: ScanEvent = {
      at,
      qrValue: clean,
      type: "checkpoint_match" as const,
      checkpointId: matched.id,
      checkpointName: matched.name,
      lat: gps?.lat,
      lng: gps?.lng,
      accuracy: gps?.accuracy,
      geofenceDistanceMeters: geofenceDistance ?? undefined,
      geofenceInside: typeof geofenceDistance === "number" ? geofenceDistance <= geofenceRadiusMeters : undefined,
      fraudFlag: outsideGeofence ? "scan_outside_geofence" : null,
    }
    setScanEvents((prev) => [event, ...prev].slice(0, 30))
    if (activeSessionId) {
      void sendRoundEventForSessionRef.current(activeSessionId, event, clean)
    }

    if (outsideGeofence) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([120, 80, 120])
      toast({ title: "Checkpoint fuera de geofence", description: `${matched.name} escaneado a ${geofenceDistance}m (radio ${geofenceRadiusMeters}m).`, variant: "destructive" })
      return
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(90)
    toast({ title: "Checkpoint validado", description: `${matched.name} marcado como completado.` })
  }, [activeRound, activeSessionId, checkpointState, geofenceRadiusMeters, pendingStartByQr, rounds, startedAt, stopScanner, toast])

  useEffect(() => {
    applyScannedValueRef.current = applyScannedValue
  }, [applyScannedValue])

  const startNfcScan = useCallback(async () => {
    if (!nfcSupported) {
      toast({ title: "NFC no soportado", description: "Este dispositivo/navegador no permite lectura NFC web.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: (options?: { signal?: AbortSignal }) => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detecto API NDEFReader en este navegador.", variant: "destructive" })
      return
    }

    try {
      stopNfcScan()
      const controller = new AbortController()
      nfcAbortRef.current = controller
      const reader = new NdefCtor()
      await reader.scan({ signal: controller.signal })
      setIsNfcScanning(true)
      toast({ title: "NFC activo", description: "Acerque una etiqueta NFC para validar checkpoint." })

      reader.onreading = (event) => {
        const token = extractNfcToken(event)
        if (!token) return
        applyScannedValue(token)
        stopNfcScan()
      }

      reader.onreadingerror = () => {
        toast({ title: "Error NFC", description: "No se pudo leer la etiqueta NFC.", variant: "destructive" })
      }
    } catch {
      stopNfcScan()
      toast({ title: "NFC bloqueado", description: "No se pudo iniciar lector NFC. Revise permisos y HTTPS.", variant: "destructive" })
    }
  }, [applyScannedValue, nfcSupported, stopNfcScan, toast])

  const handleQrOpenChange = useCallback((open: boolean) => {
    setQrOpen(open)
    if (open) {
      void startScanner()
      return
    }
    stopScanner()
  }, [startScanner, stopScanner])

  const estimateExpectedEndAt = useCallback((startedIso: string, frequency: string | undefined) => {
    const minutesMatch = String(frequency ?? "").match(/(\d+)/)
    const minutes = Number(minutesMatch?.[1] ?? 30)
    const base = new Date(startedIso).getTime()
    if (Number.isNaN(base)) return null
    return new Date(base + Math.max(5, minutes) * 60 * 1000).toISOString()
  }, [])

  const sendRoundEventForSession = useCallback(async (sessionId: string, event: ScanEvent, token?: string) => {
    if (!activeRound?.id || !sessionId) return
    if (!event.checkpointId) return

    try {
      await fetch(`/api/rounds/sessions/${encodeURIComponent(sessionId)}/event`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          roundId: activeRound.id,
          checkpointId: event.checkpointId,
          checkpointName: event.checkpointName,
          eventType: event.type,
          token,
          lat: event.lat,
          lng: event.lng,
          accuracy: event.accuracy,
          distanceToTargetMeters: event.geofenceDistanceMeters,
          insideGeofence: event.geofenceInside,
          fraudFlag: event.fraudFlag ?? null,
          capturedAt: event.at,
        }),
      })
    } catch {
      // Best effort: no bloquea boleta si falla red/API.
    }
  }, [activeRound])

  const startRoundSession = useCallback(async (startedIso: string) => {
    if (!activeRound?.id || activeSessionId || isStartingSessionRef.current) return null
    isStartingSessionRef.current = true
    try {
      const response = await fetch("/api/rounds/sessions/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          roundId: activeRound.id,
          roundName: String(activeRound.name ?? ""),
          postName: String(activeRound.post ?? ""),
          officerId: user?.uid ?? user?.email ?? null,
          officerName: String(user?.firstName ?? user?.email ?? ""),
          startedAt: startedIso,
          expectedEndAt: estimateExpectedEndAt(startedIso, activeRound.frequency),
          checkpointsTotal: checkpointState.length,
        }),
      })

      if (!response.ok) return null
      const data = (await response.json()) as { sessionId?: string }
      const sessionId = String(data.sessionId ?? "").trim()
      if (!sessionId) return null
      setActiveSessionId(sessionId)
      return sessionId
    } catch {
      return null
    } finally {
      isStartingSessionRef.current = false
    }
  }, [activeRound, activeSessionId, checkpointState.length, estimateExpectedEndAt, user])

  const finishRoundSession = useCallback(async (payload: {
    endedAt: string
    status: string
    checkpointsCompleted: number
    checkpointsTotal: number
    notes?: string | null
    reportId?: string | null
  }) => {
    if (!activeSessionId) return
    try {
      await fetch(`/api/rounds/sessions/${encodeURIComponent(activeSessionId)}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      })
    } catch {
      // Best effort: no bloquea guardado de boleta.
    }
  }, [activeSessionId])

  useEffect(() => {
    sendRoundEventForSessionRef.current = sendRoundEventForSession
  }, [sendRoundEventForSession])

  useEffect(() => {
    startRoundSessionRef.current = startRoundSession
  }, [startRoundSession])

  const handleStartBulletin = () => {
    if (!activeRound) {
      toast({ title: "Seleccione una ronda", description: "Debe elegir una ronda antes de iniciar.", variant: "destructive" })
      return
    }
    if (!checkpointState.length) {
      setCheckpointState(buildCheckpointState(activeRound))
    }
    if (!preRoundCondition) {
      toast({ title: "Pre-ronda incompleta", description: "Indique estado del lugar antes de iniciar.", variant: "destructive" })
      return
    }

    setPendingStartByQr(true)
    setStartQrValidated(false)
    setGpsError("geolocation" in navigator ? null : "GPS no disponible en este dispositivo.")
    setScanEvents((prev) => [{ at: nowIso(), qrValue: activeRound.id, type: "round_selected" as const }, ...prev].slice(0, 30))
    toast({ title: "Listo para iniciar", description: "Escanee el primer codigo QR/NFC asignado para arrancar la ronda." })
    void handleQrOpenChange(true)
  }

  const markCheckpointManual = (checkpointId: string) => {
    if (!canManualCheckpointValidation) {
      toast({ title: "Accion restringida", description: "Solo L4 puede validar checkpoints en modo manual.", variant: "destructive" })
      return
    }
    if (!startedAt) {
      toast({ title: "Inicie la boleta", description: "Pulse INICIAR antes de marcar checkpoints.", variant: "destructive" })
      return
    }
    const at = nowIso()
    const cp = checkpointState.find((item) => item.id === checkpointId)
    if (!cp) return
    setCheckpointState((prev) => prev.map((item) => item.id === checkpointId ? { ...item, completedAt: at, completedByQr: item.completedByQr ?? "manual" } : item))
    const event: ScanEvent = { at, qrValue: "manual", type: "checkpoint_match" as const, checkpointId: cp.id, checkpointName: cp.name, fraudFlag: "manual_validation" }
    setScanEvents((prev) => [event, ...prev].slice(0, 30))
    if (activeSessionId) {
      void sendRoundEventForSession(activeSessionId, event, "manual")
    }
  }

  const resetBulletin = () => {
    if (!activeRound) return
    stopNfcScan()
    setCheckpointState(buildCheckpointState(activeRound))
    setScanEvents([])
    setStartedAt(null)
    setPendingStartByQr(false)
    setStartQrValidated(false)
    setActiveSessionId(null)
    setNotes("")
    setPhotos([])
    setGpsTrack([])
    setDistanceMeters(0)
    setElapsedSeconds(0)
    setGpsError(null)
    latestGpsPointRef.current = null
    setPreRoundCondition("NORMAL")
    setPreRoundNotes("")
    setCheckDoorsClosed(true)
    setCheckLightsOk(true)
    setCheckPerimeterOk(true)
    setCheckNoStrangers(true)
  }

  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file?.type.startsWith("image/")) return

    const reader = new FileReader()
    reader.onload = () => {
      setPhotos((prev) => [...prev, String(reader.result ?? "")].filter(Boolean))
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }

  const addPhoto = () => photoInputRef.current?.click()

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSaveBulletin = async () => {
    if (!activeRound || !startedAt) {
      toast({ title: "Boleta incompleta", description: "Seleccione ronda e inicie la boleta.", variant: "destructive" })
      return
    }

    const endedAt = nowIso()
    const status = completedCount === totalCount && totalCount > 0 ? "COMPLETA" : "PARCIAL"
    const alerts = computeRoundAlerts(gpsTrack, scanEvents, startedAt, endedAt, securityConfig)

    setSaving(true)
    const payload = {
      round_id: activeRound.id,
      round_name: String(activeRound.name ?? ""),
      post_name: String(activeRound.post ?? ""),
      officer_id: user?.uid ?? null,
      officer_name: String(user?.firstName ?? user?.email ?? ""),
      started_at: startedAt,
      ended_at: endedAt,
      status,
      checkpoints_total: totalCount,
      checkpoints_completed: completedCount,
      checkpoint_logs: {
        checkpoints: checkpointState,
        events: scanEvents,
        photos,
        gps_track: gpsTrack,
        gps_distance_meters: Math.round(distanceMeters),
        elapsed_seconds: elapsedSeconds,
        pre_round: {
          condition: preRoundCondition,
          notes: preRoundNotes.trim() || null,
          checklist: {
            doorsClosed: checkDoorsClosed,
            lightsOk: checkLightsOk,
            perimeterOk: checkPerimeterOk,
            noStrangers: checkNoStrangers,
          },
        },
        alerts,
      },
      notes: notes.trim() || null,
      created_at: endedAt,
    }

    const result = await runMutationWithOffline(supabase, {
      table: "round_reports",
      action: "insert",
      payload,
    })
    if (!result.ok) {
      const rawError = String(result.error ?? "")
      if (isRoundReportsMissingTableError(rawError)) {
        const contingency = await runMutationWithOffline(supabase, {
          table: "supervisions",
          action: "insert",
          payload: {
            operation_name: String(activeRound.name ?? "Ronda"),
            officer_name: String(user?.firstName ?? user?.email ?? "Oficial"),
            review_post: String(activeRound.post ?? "Puesto"),
            supervisor_id: user?.email ?? user?.uid ?? null,
            status: status === "COMPLETA" ? "CUMPLIM" : "CON NOVEDAD",
            type: "BOLETA_RONDA",
            observations: [
              notes?.trim() ? `Boleta: ${notes.trim()}` : "Boleta de ronda registrada en modo contingencia.",
              `Pre-ronda: ${preRoundCondition}`,
              `Distancia: ${(distanceMeters / 1000).toFixed(2)} km`,
              `Duracion: ${formatDurationLabel(elapsedSeconds)}`,
              alerts.messages.length ? `Alertas: ${alerts.messages.join("; ")}` : "Alertas: Sin alertas criticas",
            ].join(" | "),
            photos,
            created_at: endedAt,
          },
        })

        setSaving(false)
        await finishRoundSession({
          endedAt,
          status,
          checkpointsCompleted: completedCount,
          checkpointsTotal: totalCount,
          notes: notes.trim() || null,
          reportId: null,
        })
        if (!contingency.ok) {
          toast({ title: "Error", description: contingency.error || rawError, variant: "destructive" })
          return
        }

        toast({
          title: contingency.queued ? "Boleta en cola" : "Boleta guardada",
          description: contingency.queued
            ? "Sin conexion: se sincronizara automaticamente al reconectar."
            : "Guardada en modo contingencia. Falta crear tabla round_reports en la base de datos.",
        })
        toast({
          title: "Pendiente de base de datos",
          description: "Ejecute supabase/create_round_reports.sql para habilitar historial de boletas nativo.",
          variant: "destructive",
        })
        resetBulletin()
        return
      }

      setSaving(false)
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    setSaving(false)
    await finishRoundSession({
      endedAt,
      status,
      checkpointsCompleted: completedCount,
      checkpointsTotal: totalCount,
      notes: notes.trim() || null,
      reportId: null,
    })

    toast({
      title: result.queued ? "Boleta en cola" : "Boleta guardada",
      description: result.queued
        ? "Sin conexion: se sincronizara automaticamente al reconectar."
        : `Boleta ${status.toLowerCase()} almacenada correctamente.`,
    })

    resetBulletin()
  }

  useEffect(() => {
    if (!startedAt) return

    const tick = window.setInterval(() => {
      const base = new Date(startedAt).getTime()
      if (Number.isNaN(base)) return
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)))
    }, 1000)

    if (!("geolocation" in navigator)) return () => window.clearInterval(tick)

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point: GpsPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: typeof position.coords.speed === "number" ? position.coords.speed : null,
          recordedAt: nowIso(),
          ts: Date.now(),
        }
        setGpsError(null)
        latestGpsPointRef.current = point
        setGpsTrack((prev) => {
          const last = prev[prev.length - 1]
          if (last) {
            const step = haversineDistanceMeters(last, point)
            if (step < 2) return prev
            setDistanceMeters((d) => d + step)
          }
          return [...prev, point].slice(-2400)
        })
      },
      (err) => {
        setGpsError(err.message || "No se pudo obtener la ubicacion.")
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    )

    return () => {
      window.clearInterval(tick)
      if (gpsWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current)
        gpsWatchIdRef.current = null
      }
    }
  }, [startedAt])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">BOLETA DE RONDA</h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Ejecucion independiente de rondas por escaneo QR/NFC de checkpoints.
          </p>
          {isL1Operator ? (
            <p className="text-[10px] uppercase font-black tracking-wide text-cyan-300">Modo rapido L1 activo</p>
          ) : null}
        </div>
        <Button asChild className="h-10 bg-primary text-black font-black uppercase gap-2">
          <Link href="/rounds/new">
            <Plus className="w-4 h-4" /> Nueva ronda
          </Link>
        </Button>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Nueva boleta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {canEditFraudConfig && (
            <div className="rounded border border-cyan-500/30 bg-cyan-500/10 p-3 space-y-3">
              <p className="text-[10px] font-black uppercase text-cyan-200">Config geofencing y antifraude (L4)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Radio geofence (m)</Label>
                  <Input
                    type="number"
                    min={20}
                    max={300}
                    value={geofenceRadiusMeters}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setGeofenceRadiusMeters(Math.max(20, Math.min(300, Number(e.target.value || 50))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Brecha sin QR/NFC (min)</Label>
                  <Input
                    type="number"
                    min={3}
                    max={30}
                    value={noScanGapMinutes}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setNoScanGapMinutes(Math.max(3, Math.min(30, Number(e.target.value || 10))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Salto GPS (m)</Label>
                  <Input
                    type="number"
                    min={60}
                    max={500}
                    value={maxJumpMeters}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setMaxJumpMeters(Math.max(60, Math.min(500, Number(e.target.value || 120))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="h-8 bg-primary text-black font-black uppercase"
                  onClick={() => void handleSaveSecurityConfig()}
                  disabled={isSavingSecurityConfig}
                >
                  {isSavingSecurityConfig ? "Guardando..." : "Guardar config global"}
                </Button>
                <span className="text-[10px] text-cyan-100/80 uppercase">
                  Fuente activa: {serverSecurityConfig ? "Servidor" : "Local"}
                </span>
              </div>
              {securityConfigError ? (
                <p className="text-[10px] text-amber-200 uppercase">Config servidor no disponible: usando valores locales.</p>
              ) : null}
              {recentFraudNotifications.length > 0 ? (
                <div className="rounded border border-red-500/30 bg-red-500/10 p-2">
                  <p className="text-[10px] font-black uppercase text-red-200 mb-1">Notificaciones antifraude recientes</p>
                  <div className="space-y-1">
                    {recentFraudNotifications.map((n) => (
                      <p key={n.id} className="text-[10px] text-red-100">
                        [{n.at?.toLocaleString?.() ?? "-"}] {n.roundName} / {n.officerName}: {n.messages[0]}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-cyan-100/80 uppercase">Sin alertas antifraude recientes.</p>
              )}
            </div>
          )}

          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={handlePhotoFile}
          />

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Ronda</Label>
              <Select value={activeRoundId} onValueChange={handleRoundChange}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccione una ronda" /></SelectTrigger>
                <SelectContent>
                  {rounds.map((round) => (
                    <SelectItem key={round.id} value={String(round.id)}>
                      {String(round.name ?? "Ronda")} - {String(round.post ?? "Puesto")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleStartBulletin} className="h-10 bg-primary text-black font-black uppercase" disabled={!activeRound || !!startedAt || pendingStartByQr}>
              {pendingStartByQr ? "Esperando codigo..." : isL1Operator ? "Inicio rapido" : "Iniciar QR/NFC"}
            </Button>
            <Button variant="outline" onClick={() => handleQrOpenChange(true)} className="h-10 border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2">
              <QrCode className="w-4 h-4" /> QR
            </Button>
            <Button
              variant="outline"
              onClick={() => void startNfcScan()}
              className="h-10 border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2"
              disabled={!nfcSupported || isNfcScanning}
            >
              <ScanLine className="w-4 h-4" /> {isNfcScanning ? "NFC activo" : "NFC"}
            </Button>
            <Button variant="ghost" onClick={resetBulletin} className="h-10 font-black uppercase text-white/70 hover:text-white">
              Limpiar
            </Button>
          </div>

          {!nfcSupported ? (
            <p className="text-[10px] text-amber-300 uppercase">NFC web no disponible en este dispositivo/navegador.</p>
          ) : null}

          <div className="rounded border border-white/10 bg-black/30 p-3 space-y-3">
            <p className="text-[10px] font-black uppercase text-white/70">Pre-ronda: estado del lugar</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Condicion general</Label>
                <Select value={preRoundCondition} onValueChange={setPreRoundCondition}>
                  <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Estado general" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NORMAL">Normal</SelectItem>
                    <SelectItem value="NOVEDAD">Con novedad</SelectItem>
                    <SelectItem value="RIESGO">Riesgo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Observacion inicial</Label>
                <Input
                  value={preRoundNotes}
                  onChange={(e) => setPreRoundNotes(e.target.value)}
                  placeholder="Estado del puesto al iniciar"
                  className="h-10 bg-black/30 border-white/10 text-white"
                />
              </div>
            </div>
            {!isL1Operator ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkDoorsClosed} onChange={(e) => setCheckDoorsClosed(e.target.checked)} /> Puertas cerradas</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkLightsOk} onChange={(e) => setCheckLightsOk(e.target.checked)} /> Luces y alarmas OK</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkPerimeterOk} onChange={(e) => setCheckPerimeterOk(e.target.checked)} /> Perimetro sin riesgo</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkNoStrangers} onChange={(e) => setCheckNoStrangers(e.target.checked)} /> Sin personas extranas</label>
              </div>
            ) : (
              <p className="text-[10px] text-white/50 uppercase">Checklist rapido autoasumido en OK para acelerar ronda L1.</p>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-[10px] uppercase font-black text-white/50">Estado inicio</p>
              <p className="text-sm font-black text-white">{startQrValidated ? "Validado" : pendingStartByQr ? "Pendiente QR" : "No iniciado"}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-[10px] uppercase font-black text-white/50">Tiempo</p>
              <p className="text-sm font-black text-white">{formatDurationLabel(elapsedSeconds)}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-[10px] uppercase font-black text-white/50">Distancia</p>
              <p className="text-sm font-black text-white">{distanceKm.toFixed(2)} km</p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-3">
              <p className="text-[10px] uppercase font-black text-white/50">Puntos GPS</p>
              <p className="text-sm font-black text-white">{gpsTrack.length}</p>
            </div>
          </div>

          <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] uppercase font-black text-white/60">Trazado de ruta (GPS)</p>
              {gpsError ? <span className="text-[10px] uppercase font-bold text-amber-300">{gpsError}</span> : null}
            </div>
            <div className="h-[150px] rounded border border-white/10 bg-black/50 flex items-center justify-center overflow-hidden">
              {trackPath ? (
                <svg width="100%" height="100%" viewBox="0 0 340 140" preserveAspectRatio="none">
                  <path d={trackPath} stroke="#22d3ee" strokeWidth="2" fill="none" />
                </svg>
              ) : (
                <p className="text-[10px] text-white/50 uppercase">Inicie la ronda para ver el trazado</p>
              )}
            </div>
            {latestGpsPoint ? (
              <p className="text-[10px] text-white/50 uppercase">
                Ultimo GPS: {latestGpsPoint.lat.toFixed(5)}, {latestGpsPoint.lng.toFixed(5)} | acc {Math.round(latestGpsPoint.accuracy)}m
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-white/70">
              <span>Avance checkpoints</span>
              <span>{completedCount}/{totalCount}</span>
            </div>
            <Progress value={progress} className="h-3 bg-white/10" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            <div className="space-y-2">
              {roundsLoading ? (
                <div className="h-28 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : checkpointState.length === 0 ? (
                <div className="rounded border border-white/10 p-4 text-[11px] text-white/60">Seleccione una ronda para cargar checkpoints.</div>
              ) : (
                checkpointState.map((cp) => (
                  <div key={cp.id} className="rounded border border-white/10 p-3 flex items-center justify-between gap-3 bg-black/30">
                    <div>
                      <p className="text-[11px] font-black uppercase text-white">{cp.name}</p>
                      <p className="text-[10px] text-white/50">QR: {cp.qrCodes.length || 0} | NFC: {cp.nfcCodes.length || 0}{cp.completedByQr ? ` | Validado por: ${cp.completedByQr}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {cp.completedAt ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-green-400">
                          <CheckCircle2 className="w-4 h-4" /> OK
                        </span>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-300">
                            <Circle className="w-3 h-3" /> Pendiente
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-white/20 text-white text-[9px] uppercase"
                            onClick={() => markCheckpointManual(cp.id)}
                            disabled={!canManualCheckpointValidation}
                          >
                            {canManualCheckpointValidation ? "Manual" : "Manual L4"}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              )}

              <div className="space-y-1 pt-2">
                <Label className="text-[10px] uppercase font-black text-white/70">Observaciones boleta</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-black/30 border-white/10 min-h-[90px]" placeholder="Novedades o comentarios de la ronda..." />
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-[10px] uppercase font-black text-white/70">Evidencia fotografica</Label>
                  <Button type="button" onClick={addPhoto} variant="outline" className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase gap-1">
                    <Camera className="w-3.5 h-3.5" /> Agregar foto
                  </Button>
                </div>
                {photos.length === 0 ? (
                  <p className="text-[10px] text-white/50">Sin fotos adjuntas por ahora.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((photo, i) => (
                      <div key={`${photo.slice(0, 24)}-${i}`} className="relative aspect-square rounded overflow-hidden border border-white/10">
                        <Image src={photo} alt={`Evidencia ${i + 1}`} fill unoptimized sizes="(max-width: 640px) 33vw, 10vw" className="object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 bg-black/70 border border-white/20 rounded p-1 text-white hover:bg-red-700/80"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button onClick={handleSaveBulletin} disabled={!activeRound || !startedAt || saving} className="w-full h-11 bg-primary text-black font-black uppercase gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Guardar boleta
              </Button>
            </div>

            <Card className="bg-black/30 border-white/10">
              <CardHeader className="pb-2">
                <CardTitle className="text-[11px] font-black uppercase text-white">Eventos QR</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-[430px] overflow-y-auto">
                {scanEvents.length === 0 ? (
                  <p className="text-[10px] text-white/50">Sin eventos por ahora.</p>
                ) : (
                  scanEvents.map((event, index) => (
                    <div key={`${event.at}-${index}`} className="rounded border border-white/10 p-2 text-[10px] bg-black/40">
                      <p className="font-black uppercase text-white/80">{event.type.replaceAll("_", " ")}</p>
                      <p className="text-white/60">{event.checkpointName ?? "-"}</p>
                      <p className="text-white/50 font-mono break-all">{event.qrValue}</p>
                      {(typeof event.lat === "number" && typeof event.lng === "number") ? (
                        <p className="text-white/40 font-mono">GPS {event.lat.toFixed(5)}, {event.lng.toFixed(5)}{typeof event.accuracy === "number" ? ` | acc ${Math.round(event.accuracy)}m` : ""}</p>
                      ) : null}
                      {typeof event.geofenceDistanceMeters === "number" ? (
                        <p className={event.geofenceInside === false ? "text-red-300 font-mono" : "text-emerald-300 font-mono"}>
                          Geofence: {event.geofenceDistanceMeters}m / radio {geofenceRadiusMeters}m
                        </p>
                      ) : null}
                      {event.fraudFlag ? (
                        <p className="text-red-300 font-bold uppercase">Alerta: {event.fraudFlag.replaceAll("_", " ")}</p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Historial de boletas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Fecha desde</Label>
              <Input
                type="date"
                value={historyDateFromFilter}
                onChange={(e) => setHistoryDateFromFilter(e.target.value)}
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Fecha hasta</Label>
              <Input
                type="date"
                value={historyDateToFilter}
                onChange={(e) => setHistoryDateToFilter(e.target.value)}
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Hora (HH:mm)</Label>
              <Input
                value={historyHourFilter}
                onChange={(e) => setHistoryHourFilter(e.target.value)}
                placeholder="14:30"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Operacion</Label>
              <Input
                value={historyOperationFilter}
                onChange={(e) => setHistoryOperationFilter(e.target.value)}
                placeholder="Ronda Norte"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Lugar</Label>
              <Input
                value={historyLocationFilter}
                onChange={(e) => setHistoryLocationFilter(e.target.value)}
                placeholder="Puesto / Posta"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Supervisor</Label>
              <Input
                value={historySupervisorFilter}
                onChange={(e) => setHistorySupervisorFilter(e.target.value)}
                placeholder="Nombre o correo"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1 flex items-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full border-white/20 text-white hover:bg-white/10 font-black uppercase"
                onClick={() => {
                  setHistoryDateFromFilter("")
                  setHistoryDateToFilter("")
                  setHistoryHourFilter("")
                  setHistoryOperationFilter("")
                  setHistoryLocationFilter("")
                  setHistorySupervisorFilter("")
                }}
              >
                Limpiar filtros
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase font-black text-white/50">Rango rapido:</span>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(1)}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(7)}
            >
              7 dias
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(30)}
            >
              30 dias
            </Button>
          </div>

          <p className="text-[10px] text-white/50 uppercase font-bold tracking-wide">
            Mostrando {filteredReports.length} de {scopedReports.length} boletas
          </p>

          {reportsLoading ? (
            <div className="h-24 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : reports.length === 0 ? (
            <p className="text-[11px] text-white/60">Sin boletas registradas.</p>
          ) : filteredReports.length === 0 ? (
            <p className="text-[11px] text-white/60">No hay boletas que coincidan con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-white/10">
                  <tr>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Fecha</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Hora</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Ronda</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Lugar</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Oficial</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Supervisor</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Avance</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Estado</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Alertas</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((r) => {
                    const safeDate = getReportCreatedDate(r)
                    const alertMessages = getStoredAlertMessages(r)
                    const reportTrack = getReportTrack(r)
                    return (
                    <tr key={r.id} className="border-b border-white/5">
                      <td className="py-2 text-[10px] text-white/70">{safeDate?.toLocaleDateString?.() ?? "-"}</td>
                      <td className="py-2 text-[10px] text-white/70">{safeDate?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-"}</td>
                      <td className="py-2 text-[10px] text-white">{String(r.roundName ?? "-")}</td>
                      <td className="py-2 text-[10px] text-white/70">{String(r.postName ?? "-")}</td>
                      <td className="py-2 text-[10px] text-white/70">{String(r.officerName ?? "-")}</td>
                      <td className="py-2 text-[10px] text-white/70">{String(r.supervisorName ?? r.supervisorId ?? r.officerName ?? "-")}</td>
                      <td className="py-2 text-[10px] text-white/70">{Number(r.checkpointsCompleted ?? 0)}/{Number(r.checkpointsTotal ?? 0)}</td>
                      <td className="py-2 text-[10px] font-black">
                        <span className={String(r.status ?? "").toUpperCase() === "COMPLETA" ? "text-green-400" : "text-amber-300"}>
                          {String(r.status ?? "-")}
                        </span>
                      </td>
                      <td className="py-2 text-[10px] text-white/70">{alertMessages.length}</td>
                      <td className="py-2 text-[10px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => handleOpenRoundDetail(r)}
                          >
                            Info
                          </Button>
                          {canEditRoundReports ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 border-white/20 text-amber-200 hover:bg-white/10 text-[9px] font-black uppercase"
                              onClick={() => handleOpenRoundEdit(r)}
                            >
                              Editar
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            disabled={reportTrack.length < 2}
                            onClick={() => {
                              setHistoryTrackReport(r)
                              setHistoryTrackOpen(true)
                            }}
                          >
                            Ruta
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-emerald-200 hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => void handleExportSingleExcel(r)}
                          >
                            <FileSpreadsheet className="w-3 h-3 mr-1" /> Excel
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-cyan-100 hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => void handleExportSinglePdf(r)}
                          >
                            <FileDown className="w-3 h-3 mr-1" /> PDF
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            disabled={reportTrack.length < 2}
                            onClick={() => downloadGpxFromReport(r)}
                          >
                            <Download className="w-3 h-3 mr-1" /> GPX
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={qrOpen} onOpenChange={handleQrOpenChange}>
        <DialogContent className="bg-black border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Lector QR</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              {pendingStartByQr ? "Escanee el codigo de inicio QR/NFC asignado para arrancar la ronda." : "Escanee QR de ronda o checkpoint. NFC disponible desde boton dedicado."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded border border-white/10 bg-black/40 h-60 overflow-hidden relative flex items-center justify-center">
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

            {canManualCheckpointValidation ? (
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Ingreso manual</Label>
                <Textarea
                  value={qrInput}
                  onChange={(e) => setQrInput(e.target.value)}
                  className="bg-black/30 border-white/10 min-h-[70px]"
                  placeholder="Pegue aqui el contenido del QR"
                />
              </div>
            ) : null}
          </div>

          <DialogFooter>
            {canManualCheckpointValidation ? (
              <Button
                variant="outline"
                className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
                onClick={() => {
                  if (!qrInput.trim()) return
                  applyScannedValue(qrInput)
                }}
              >
                Aplicar manual
              </Button>
            ) : (
              <p className="text-[10px] text-white/50 uppercase">Ingreso manual habilitado solo para L4</p>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isL1Operator && (startedAt || pendingStartByQr) ? (
        <Button
          type="button"
          onClick={() => handleQrOpenChange(true)}
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full bg-primary text-black shadow-xl"
        >
          <QrCode className="w-5 h-5" />
        </Button>
      ) : null}

      <Dialog open={historyTrackOpen} onOpenChange={setHistoryTrackOpen}>
        <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Ruta de boleta</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              {historyTrackReport ? `${String(historyTrackReport.roundName ?? "Ronda")} - ${String(historyTrackReport.officerName ?? "Oficial")}` : ""}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="h-[240px] rounded border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
              {historyTrack.length >= 2 ? (
                <TacticalMap
                  className="w-full h-full"
                  center={historyMapCenter}
                  zoom={15}
                  interactive={true}
                  markers={historyMapMarkers}
                  routePath={historyTrack.map((p) => ({ lng: p.lng, lat: p.lat }))}
                />
              ) : (
                <p className="text-[10px] text-white/50 uppercase">Sin trazado disponible</p>
              )}
            </div>

            {historyTrackPath ? (
              <div className="h-[100px] rounded border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
                <svg width="100%" height="100%" viewBox="0 0 520 220" preserveAspectRatio="none">
                  <path d={historyTrackPath} stroke="#22d3ee" strokeWidth="2" fill="none" />
                </svg>
              </div>
            ) : null}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
              <div className="rounded border border-white/10 bg-black/30 p-2">
                <p className="uppercase text-white/50 font-black">Puntos GPS</p>
                <p className="text-white font-black">{historyTrack.length}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-2">
                <p className="uppercase text-white/50 font-black">Avance</p>
                <p className="text-white font-black">{Number(historyTrackReport?.checkpointsCompleted ?? 0)}/{Number(historyTrackReport?.checkpointsTotal ?? 0)}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-2">
                <p className="uppercase text-white/50 font-black">Alertas</p>
                <p className="text-white font-black">{historyTrackReport ? getStoredAlertMessages(historyTrackReport).length : 0}</p>
              </div>
            </div>

            {historyTrackReport && getStoredAlertMessages(historyTrackReport).length > 0 ? (
              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
                <p className="text-[10px] uppercase font-black text-amber-200 mb-1">Alertas detectadas</p>
                <div className="space-y-1">
                  {getStoredAlertMessages(historyTrackReport).map((msg, idx) => (
                    <p key={`${msg}-${idx}`} className="text-[10px] text-amber-100">- {msg}</p>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
              onClick={() => historyTrackReport && downloadGpxFromReport(historyTrackReport)}
              disabled={!historyTrackReport || historyTrack.length < 2}
            >
              <Download className="w-4 h-4 mr-1" /> Descargar GPX
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={historyDetailOpen} onOpenChange={setHistoryDetailOpen}>
        <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Informacion de boleta de ronda</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              {historyDetailReport ? `${String(historyDetailReport.roundName ?? "Ronda")} - ${String(historyDetailReport.officerName ?? "Oficial")}` : ""}
            </DialogDescription>
          </DialogHeader>

          {historyDetailReport ? (
            <div className="space-y-3 text-[11px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div><span className="text-white/50">Codigo:</span> {getRoundReportCode(historyDetailReport)}</div>
                <div><span className="text-white/50">Fecha:</span> {getReportCreatedDate(historyDetailReport)?.toLocaleString?.() ?? "-"}</div>
                <div><span className="text-white/50">Ronda:</span> {String(historyDetailReport.roundName ?? "-")}</div>
                <div><span className="text-white/50">Lugar:</span> {String(historyDetailReport.postName ?? "-")}</div>
                <div><span className="text-white/50">Oficial:</span> {String(historyDetailReport.officerName ?? "-")}</div>
                <div><span className="text-white/50">Supervisor:</span> {String(historyDetailReport.supervisorName ?? historyDetailReport.supervisorId ?? "-")}</div>
                <div><span className="text-white/50">Estado:</span> {String(historyDetailReport.status ?? "-")}</div>
                <div><span className="text-white/50">Avance:</span> {Number(historyDetailReport.checkpointsCompleted ?? 0)}/{Number(historyDetailReport.checkpointsTotal ?? 0)}</div>
              </div>

              <div className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
                <div>
                  <p className="text-white/50 uppercase font-black">Pre-ronda</p>
                  <p className="font-black">{getRoundLogDetails(historyDetailReport).preRoundCondition}</p>
                </div>
                <div>
                  <p className="text-white/50 uppercase font-black">Distancia</p>
                  <p className="font-black">{getRoundLogDetails(historyDetailReport).distanceKm} km</p>
                </div>
                <div>
                  <p className="text-white/50 uppercase font-black">Duracion</p>
                  <p className="font-black">{getRoundLogDetails(historyDetailReport).duration}</p>
                </div>
                <div>
                  <p className="text-white/50 uppercase font-black">Evidencias</p>
                  <p className="font-black">{getRoundLogDetails(historyDetailReport).evidenceCount}</p>
                </div>
                <div>
                  <p className="text-white/50 uppercase font-black">Eventos QR</p>
                  <p className="font-black">{getRoundLogDetails(historyDetailReport).eventsCount}</p>
                </div>
                <div>
                  <p className="text-white/50 uppercase font-black">Alertas</p>
                  <p className="font-black">{getStoredAlertMessages(historyDetailReport).length}</p>
                </div>
              </div>

              <div>
                <p className="text-[10px] text-white/50 uppercase font-black mb-1">Observaciones</p>
                <p className="text-[11px] whitespace-pre-wrap text-white/80">{String(historyDetailReport.notes ?? "-")}</p>
              </div>

              <div>
                <p className="text-[10px] text-white/50 uppercase font-black mb-1">Notas pre-ronda</p>
                <p className="text-[11px] whitespace-pre-wrap text-white/80">{getRoundLogDetails(historyDetailReport).preRoundNotes}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={historyEditOpen} onOpenChange={setHistoryEditOpen}>
        <DialogContent className="bg-black border-white/10 text-white max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Editar boleta de ronda (L4)</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              Corrija nombre de oficial, supervisor, estado u observaciones.
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Ronda</Label>
              <Input value={historyEditRoundName} onChange={(e) => setHistoryEditRoundName(e.target.value)} className="bg-black/30 border-white/10 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Lugar</Label>
              <Input value={historyEditPostName} onChange={(e) => setHistoryEditPostName(e.target.value)} className="bg-black/30 border-white/10 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Oficial</Label>
              <Input value={historyEditOfficerName} onChange={(e) => setHistoryEditOfficerName(e.target.value)} className="bg-black/30 border-white/10 text-white" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Supervisor</Label>
              <Input value={historyEditSupervisorName} onChange={(e) => setHistoryEditSupervisorName(e.target.value)} className="bg-black/30 border-white/10 text-white" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
              <Select value={historyEditStatus} onValueChange={setHistoryEditStatus}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPLETA">COMPLETA</SelectItem>
                  <SelectItem value="PARCIAL">PARCIAL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Observaciones</Label>
              <Textarea value={historyEditNotes} onChange={(e) => setHistoryEditNotes(e.target.value)} className="bg-black/30 border-white/10 min-h-[90px] text-white" />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
              onClick={() => setHistoryEditOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              className="bg-primary text-black font-black uppercase"
              onClick={() => void handleSaveRoundEdit()}
              disabled={isSavingHistoryEdit}
            >
              {isSavingHistoryEdit ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
