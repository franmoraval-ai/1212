// Pure types and utility functions extracted from rounds/page.tsx
// No React dependencies — all functions are stateless and side-effect free.

export type RoundCheckpoint = {
  name?: string
  qrCodes?: string[]
  qr_codes?: string[]
  nfcCodes?: string[]
  nfc_codes?: string[]
  lat?: number
  lng?: number
}

export type RoundRow = {
  id: string
  name?: string
  post?: string
  status?: string
  frequency?: string
  instructions?: string | null
  checkpoints?: RoundCheckpoint[]
}

export type RoundReportRow = {
  id: string
  startedAt?: { toDate?: () => Date }
  started_at?: string | Date | { toDate?: () => Date }
  endedAt?: { toDate?: () => Date }
  ended_at?: string | Date | { toDate?: () => Date }
  roundId?: string
  round_id?: string
  roundName?: string
  round_name?: string
  postName?: string
  post_name?: string
  officerId?: string
  officer_id?: string
  officerName?: string
  officer_name?: string
  supervisorName?: string
  supervisor_name?: string
  supervisorId?: string
  supervisor_id?: string
  status?: string
  notes?: string | null
  checkpointsTotal?: number
  checkpoints_total?: number
  checkpointsCompleted?: number
  checkpoints_completed?: number
  createdAt?: { toDate?: () => Date }
  created_at?: string | Date | { toDate?: () => Date }
  checkpointLogs?: unknown
  checkpoint_logs?: unknown
  localOnly?: boolean
  offlineSyncCause?: string | null
  offlineLastError?: string | null
  offlineAttempts?: number
  offlineSessionKinds?: string[]
  offlineSessionLastError?: string | null
}

export type RoundSessionRow = {
  id: string
  roundId?: string
  round_id?: string
  roundName?: string
  round_name?: string
  postName?: string
  post_name?: string
  officerId?: string
  officer_id?: string
  officerName?: string
  officer_name?: string
  supervisorId?: string
  supervisor_id?: string
  status?: string
  startedAt?: string | Date | { toDate?: () => Date }
  started_at?: string | Date | { toDate?: () => Date }
  endedAt?: string | Date | { toDate?: () => Date }
  ended_at?: string | Date | { toDate?: () => Date }
  expectedEndAt?: string | Date | { toDate?: () => Date }
  expected_end_at?: string | Date | { toDate?: () => Date }
  checkpointsTotal?: number
  checkpoints_total?: number
  checkpointsCompleted?: number
  checkpoints_completed?: number
  lastScanAt?: string | Date | { toDate?: () => Date }
  last_scan_at?: string | Date | { toDate?: () => Date }
}

export type CheckpointState = {
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

export type ScanEvent = {
  at: string
  qrValue: string
  type: "round_selected" | "checkpoint_match" | "checkpoint_unmatched" | "checkpoint_reverted"
  checkpointId?: string
  checkpointName?: string
  lat?: number
  lng?: number
  accuracy?: number
  geofenceDistanceMeters?: number
  geofenceInside?: boolean
  fraudFlag?: string | null
}

export type GpsPoint = {
  lat: number
  lng: number
  accuracy: number
  speed: number | null
  recordedAt: string
  ts: number
}

export type GpxWaypoint = {
  lat: number
  lng: number
  name: string
  description?: string
  symbol?: string
}

export type RoundAlertSummary = {
  noScanGaps: number
  gpsJumps: number
  lowGpsQuality: boolean
  messages: string[]
}

export type RoundSecurityConfig = {
  geofenceRadiusMeters: number
  noScanGapMinutes: number
  maxJumpMeters: number
}

export type RoundSecurityConfigRow = {
  id: string
  geofenceRadiusMeters?: number
  noScanGapMinutes?: number
  maxJumpMeters?: number
  updatedAt?: { toDate?: () => Date }
  updatedBy?: string
}

export type BulletinContext = {
  stationLabel: string
  stationPostName: string
  officerName: string
  roundId: string
  roundName: string
}

export type ApplyScanResult = {
  checkpointName: string
} | null

export const MAX_ROUND_PHOTOS = 6

export function normalizeRoundQr(value: string) {
  try {
    const parsed = JSON.parse(value) as { id?: string; name?: string; post?: string }
    if (!parsed?.id) return null
    return { id: String(parsed.id), name: String(parsed.name ?? ""), post: String(parsed.post ?? "") }
  } catch {
    return null
  }
}

export function normalizeScanToken(value: string) {
  return String(value ?? "").trim().toLowerCase()
}

export function splitCheckpointCodeInput(value: string) {
  return Array.from(new Set(
    String(value ?? "")
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  ))
}

export function joinCheckpointCodeInput(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((item) => String(item).trim()).filter(Boolean))).join("\n")
}

export function createRoundReportId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function isRoundReportsMissingTableError(message: string) {
  const m = String(message ?? "").toLowerCase()
  return (
    (m.includes("round_reports") && m.includes("schema cache")) ||
    m.includes("could not find the table 'public.round_reports'")
  )
}

export function toInputDateLocal(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function haversineDistanceMeters(a: Pick<GpsPoint, "lat" | "lng">, b: Pick<GpsPoint, "lat" | "lng">) {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const r = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const p1 = toRad(a.lat)
  const p2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

export function formatDurationLabel(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const h = Math.floor(safe / 3600)
  const m = Math.floor((safe % 3600) / 60)
  const s = safe % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function getFrequencyMinutes(frequency: string | undefined) {
  const minutesMatch = String(frequency ?? "").match(/(\d+)/)
  const minutes = Number(minutesMatch?.[1] ?? 30)
  return Number.isFinite(minutes) ? Math.max(5, minutes) : 30
}

export function normalizeRoundCheckpoints(value: unknown): RoundCheckpoint[] {
  const normalizeArray = (items: unknown[]) => items.filter((item) => item && typeof item === "object") as RoundCheckpoint[]

  if (Array.isArray(value)) return normalizeArray(value)

  if (typeof value === "string") {
    try {
      return normalizeRoundCheckpoints(JSON.parse(value))
    } catch {
      return []
    }
  }

  if (value && typeof value === "object") {
    const maybeWrapped = value as { checkpoints?: unknown }
    if (Array.isArray(maybeWrapped.checkpoints)) {
      return normalizeArray(maybeWrapped.checkpoints)
    }
    return normalizeArray(Object.values(value))
  }

  return []
}

export function buildTrackSvgPath(points: GpsPoint[], width: number, height: number) {
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

export const DEFAULT_ROUND_SECURITY_CONFIG: RoundSecurityConfig = {
  geofenceRadiusMeters: 50,
  noScanGapMinutes: 10,
  maxJumpMeters: 120,
}

export function loadRoundSecurityConfig(): RoundSecurityConfig {
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

export function getTrackFromUnknownLogs(logs: unknown): GpsPoint[] {
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

export function getReportTrack(report: RoundReportRow): GpsPoint[] {
  return getTrackFromUnknownLogs(report.checkpointLogs ?? report.checkpoint_logs)
}

export function getRoundCheckpointWaypoints(report: RoundReportRow): GpxWaypoint[] {
  const source = report.checkpointLogs ?? report.checkpoint_logs
  if (!source || typeof source !== "object") return []

  const checkpoints = Array.isArray((source as { checkpoints?: unknown }).checkpoints)
    ? ((source as { checkpoints?: unknown[] }).checkpoints ?? [])
    : []

  const waypoints = checkpoints.map((item, index): GpxWaypoint | null => {
      const checkpoint = item as {
        name?: unknown
        lat?: unknown
        lng?: unknown
        completedAt?: unknown
      }
      const lat = Number(checkpoint.lat)
      const lng = Number(checkpoint.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

      const completedAt = String(checkpoint.completedAt ?? "").trim()
      const completed = completedAt.length > 0
      return {
        lat,
        lng,
        name: String(checkpoint.name ?? `Checkpoint ${index + 1}`).trim() || `Checkpoint ${index + 1}`,
        description: completed
          ? `Checkpoint completado ${completedAt}`
          : "Checkpoint pendiente",
        symbol: completed ? "Flag, Green" : "Flag, Yellow",
      }
    })
  return waypoints.filter((value): value is GpxWaypoint => value !== null)
}

export function buildGpxXml(points: GpsPoint[], name: string, waypoints: GpxWaypoint[] = []) {
  const esc = (v: string) => v.replace(/[<>&"']/g, (m) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[m] ?? m))
  const wpts = waypoints.map((waypoint) => {
    const desc = waypoint.description ? `\n    <desc>${esc(waypoint.description)}</desc>` : ""
    const sym = waypoint.symbol ? `\n    <sym>${esc(waypoint.symbol)}</sym>` : ""
    return `  <wpt lat="${waypoint.lat}" lon="${waypoint.lng}">\n    <name>${esc(waypoint.name)}</name>${desc}${sym}\n  </wpt>`
  }).join("\n")
  const trkpts = points.map((p) => {
    const iso = p.recordedAt || new Date(p.ts || Date.now()).toISOString()
    return `    <trkpt lat="${p.lat}" lon="${p.lng}"><time>${esc(iso)}</time></trkpt>`
  }).join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="HO-Seguridad" xmlns="http://www.topografix.com/GPX/1/1">${wpts ? `\n${wpts}` : ""}\n  <trk>\n    <name>${esc(name)}</name>\n    <trkseg>\n${trkpts}\n    </trkseg>\n  </trk>\n</gpx>`
}

export function getScanTimesMs(events: ScanEvent[]) {
  return events
    .map((e) => new Date(e.at).getTime())
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b)
}

export function computeRoundAlerts(
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

export function getStoredAlertMessages(report: RoundReportRow) {
  const logs = report.checkpointLogs ?? report.checkpoint_logs
  if (!logs || typeof logs !== "object") return [] as string[]
  const candidate = (logs as { alerts?: unknown }).alerts
  if (!candidate || typeof candidate !== "object") return []
  const messages = (candidate as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages.map((m) => String(m)) : []
}

export function getDateFromUnknown(value: unknown) {
  if (value && typeof value === "object" && "toDate" in value) {
    const candidate = (value as { toDate?: () => Date }).toDate?.()
    if (candidate && !Number.isNaN(candidate.getTime())) return candidate
  }

  const parsed = value instanceof Date
    ? value
    : typeof value === "string"
      ? new Date(value)
      : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null
}

export function getReportCreatedDate(report: RoundReportRow) {
  return getDateFromUnknown(report.createdAt) ?? getDateFromUnknown(report.created_at)
}

export function getReportStartedDate(report: RoundReportRow) {
  return getDateFromUnknown(report.startedAt) ?? getDateFromUnknown(report.started_at)
}

export function getReportEndedDate(report: RoundReportRow) {
  return getDateFromUnknown(report.endedAt) ?? getDateFromUnknown(report.ended_at)
}

export function getRoundSessionStartedDate(session: RoundSessionRow) {
  return getDateFromUnknown(session.startedAt) ?? getDateFromUnknown(session.started_at)
}

export function getRoundSessionLastScanDate(session: RoundSessionRow) {
  return getDateFromUnknown(session.lastScanAt) ?? getDateFromUnknown(session.last_scan_at)
}

export function getRoundSessionRoundId(session: RoundSessionRow) {
  return String(session.roundId ?? session.round_id ?? "")
}

export function getRoundSessionRoundName(session: RoundSessionRow) {
  return String(session.roundName ?? session.round_name ?? "")
}

export function getRoundSessionPostName(session: RoundSessionRow) {
  return String(session.postName ?? session.post_name ?? "")
}

export function getRoundSessionOfficerName(session: RoundSessionRow) {
  return String(session.officerName ?? session.officer_name ?? session.officerId ?? session.officer_id ?? "SIN ASIGNAR")
}

export function getRoundSessionProgressLabel(session: RoundSessionRow) {
  return `${Number(session.checkpointsCompleted ?? session.checkpoints_completed ?? 0)}/${Number(session.checkpointsTotal ?? session.checkpoints_total ?? 0)}`
}

export function getReportRoundName(report: RoundReportRow) {
  return String(report.roundName ?? report.round_name ?? "")
}

export function getReportRoundId(report: RoundReportRow) {
  return String(report.roundId ?? report.round_id ?? report.id ?? "")
}

export function getReportPostName(report: RoundReportRow) {
  return String(report.postName ?? report.post_name ?? "")
}

export function getReportOfficerId(report: RoundReportRow) {
  return String(report.officerId ?? report.officer_id ?? "")
}

export function getReportOfficerName(report: RoundReportRow) {
  return String(report.officerName ?? report.officer_name ?? "")
}

export function getReportSupervisorName(report: RoundReportRow) {
  return String(report.supervisorName ?? report.supervisor_name ?? report.supervisorId ?? report.supervisor_id ?? report.officerName ?? report.officer_name ?? "")
}

export function getReportProgressLabel(report: RoundReportRow) {
  return `${Number(report.checkpointsCompleted ?? report.checkpoints_completed ?? 0)}/${Number(report.checkpointsTotal ?? report.checkpoints_total ?? 0)}`
}

export function getRoundReportCode(report: RoundReportRow) {
  const date = getReportCreatedDate(report) ?? new Date()
  const y = String(date.getFullYear())
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}${m}${d}-${String(report.id).slice(0, 8)}`
}

export function classifyOfflineSyncCause(message: string | null | undefined) {
  const normalized = String(message ?? "").trim().toLowerCase()
  if (!normalized) return "Pendiente de sincronizacion"
  if (
    normalized.includes("offline") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("internet") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch")
  ) {
    return "Conectividad / señal"
  }
  return "Requiere revision"
}

export function formatOfflineSessionKinds(kinds: string[]) {
  if (kinds.length === 0) return "Sin eventos pendientes"
  return kinds.map((kind) => kind.toUpperCase()).join(" + ")
}

export function normalizeOfflineError(message: string | null | undefined) {
  const safe = String(message ?? "").trim()
  return safe || "Sin detalle adicional en cola local."
}

export function formatRoundExportDateTime(value: Date | null) {
  return value?.toLocaleString?.() ?? "-"
}

export function formatRoundGpsPoint(point: Pick<GpsPoint, "lat" | "lng"> | null) {
  if (!point) return "-"
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return "-"
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`
}

export function formatRoundBooleanLabel(value: unknown) {
  return value === true ? "SI" : value === false ? "NO" : "-"
}

export function getRoundCompletionRateLabel(report: RoundReportRow) {
  const total = Number(report.checkpointsTotal ?? report.checkpoints_total ?? 0)
  const completed = Number(report.checkpointsCompleted ?? report.checkpoints_completed ?? 0)
  if (total <= 0) return "0%"
  return `${Math.round((completed / total) * 100)}%`
}

export function summarizeRoundNames(names: string[], fallback: string) {
  const filtered = names.map((item) => item.trim()).filter(Boolean)
  return filtered.length ? filtered.join(" | ") : fallback
}

export function getRoundLogDetails(report: RoundReportRow) {
  const source = report.checkpointLogs ?? report.checkpoint_logs
  if (!source || typeof source !== "object") {
    return {
      preRoundCondition: "-",
      preRoundNotes: "-",
      preRoundChecklist: "-",
      distanceKm: "-",
      duration: "-",
      gpsStart: "-",
      gpsEnd: "-",
      evidenceCount: 0,
      eventsCount: 0,
      manualValidations: 0,
      unmatchedScans: 0,
      offGeofenceScans: 0,
      completedCheckpoints: "Sin detalle de checkpoints",
      pendingCheckpoints: "Sin pendientes",
      eventSummary: "Sin eventos registrados",
      alertSummary: "Sin alertas",
      shiftContext: "Sin contexto de turno",
    }
  }

  const logs = source as {
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
    gps_distance_meters?: number
    elapsed_seconds?: number
    photos?: unknown
    events?: unknown
    checkpoints?: unknown
    shift_context?: {
      station_label?: string | null
      station_post_name?: string | null
      active_officer_name?: string | null
      session_user_email?: string | null
    } | null
  }

  const track = getTrackFromUnknownLogs(source)
  const gpsStart = track[0] ?? null
  const gpsEnd = track[track.length - 1] ?? null
  const events = Array.isArray(logs.events) ? logs.events as ScanEvent[] : []
  const checkpoints = Array.isArray(logs.checkpoints)
    ? logs.checkpoints as Array<{ name?: string; completedAt?: string | null }>
    : []
  const completedCheckpointNames = checkpoints
    .filter((checkpoint) => !!String(checkpoint.completedAt ?? "").trim())
    .map((checkpoint) => String(checkpoint.name ?? "").trim())
    .filter(Boolean)
  const pendingCheckpointNames = checkpoints
    .filter((checkpoint) => !String(checkpoint.completedAt ?? "").trim())
    .map((checkpoint) => String(checkpoint.name ?? "").trim())
    .filter(Boolean)
  const manualValidations = events.filter((event) => String(event.qrValue ?? "").trim().toLowerCase() === "manual").length
  const unmatchedScans = events.filter((event) => event.type === "checkpoint_unmatched").length
  const offGeofenceScans = events.filter((event) => event.fraudFlag === "scan_outside_geofence").length
  const alertMessages = getStoredAlertMessages(report)
  const checklist = logs.pre_round?.checklist
  const shiftContext = logs.shift_context

  return {
    preRoundCondition: String(logs.pre_round?.condition ?? "-"),
    preRoundNotes: String(logs.pre_round?.notes ?? "-") || "-",
    preRoundChecklist: [
      `Puertas ${formatRoundBooleanLabel(checklist?.doorsClosed)}`,
      `Luces ${formatRoundBooleanLabel(checklist?.lightsOk)}`,
      `Perimetro ${formatRoundBooleanLabel(checklist?.perimeterOk)}`,
      `Sin extranos ${formatRoundBooleanLabel(checklist?.noStrangers)}`,
    ].join(" | "),
    distanceKm: Number.isFinite(Number(logs.gps_distance_meters)) ? (Number(logs.gps_distance_meters) / 1000).toFixed(2) : "-",
    duration: Number.isFinite(Number(logs.elapsed_seconds)) ? formatDurationLabel(Number(logs.elapsed_seconds)) : "-",
    gpsStart: formatRoundGpsPoint(gpsStart),
    gpsEnd: formatRoundGpsPoint(gpsEnd),
    evidenceCount: Array.isArray(logs.photos) ? logs.photos.length : 0,
    eventsCount: events.length,
    manualValidations,
    unmatchedScans,
    offGeofenceScans,
    completedCheckpoints: summarizeRoundNames(completedCheckpointNames, "Sin checkpoints completados"),
    pendingCheckpoints: summarizeRoundNames(pendingCheckpointNames, "Sin pendientes"),
    eventSummary: [
      `Eventos ${events.length}`,
      `Manuales ${manualValidations}`,
      `No reconocidos ${unmatchedScans}`,
      `Fuera geocerca ${offGeofenceScans}`,
      `Fotos ${Array.isArray(logs.photos) ? logs.photos.length : 0}`,
    ].join(" | "),
    alertSummary: alertMessages.length ? alertMessages.join(" | ") : "Sin alertas",
    shiftContext: [
      `Estacion ${String(shiftContext?.station_label ?? shiftContext?.station_post_name ?? "-") || "-"}`,
      `Oficial activo ${String(shiftContext?.active_officer_name ?? "-") || "-"}`,
      `Sesion ${String(shiftContext?.session_user_email ?? "-") || "-"}`,
    ].join(" | "),
  }
}

export function getRoundLogPhotos(report: RoundReportRow) {
  const source = report.checkpointLogs ?? report.checkpoint_logs
  if (!source || typeof source !== "object") return [] as string[]
  const photos = (source as { photos?: unknown }).photos
  return Array.isArray(photos) ? photos.map((value) => String(value)).filter(Boolean) : []
}

export function buildRoundPhotoFileName(report: RoundReportRow, index: number) {
  return `ronda-${getRoundReportCode(report)}-evidencia-${String(index + 1).padStart(2, "0")}.jpg`
}
