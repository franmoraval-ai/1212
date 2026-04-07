// Pure types and utility functions extracted from supervision/page.tsx
// No React dependencies — all functions are stateless and side-effect free.

export const SUPERVISION_DRAFT_KEY_BASE = "supervision_form_draft_v2"
export const SUPERVISION_DRAFT_TTL_MS = 12 * 60 * 60 * 1000
export const GPS_HIGH_ACCURACY_GOAL_M = 35
export const MAX_SUPERVISION_PHOTOS = 8
export const NO_WEAPON_IN_POST_OPTION = "NO HAY ARMA EN EL PUESTO"
export const SUPERVISION_EXPORT_DETAIL_BATCH_SIZE = 100

export function getSupervisionDraftStorageKey(user: { uid?: string | null; email?: string | null } | null | undefined) {
  const identity = String(user?.uid ?? user?.email ?? "").trim().toLowerCase()
  return identity ? `${SUPERVISION_DRAFT_KEY_BASE}:${identity}` : null
}

export function normalizeIdNumberInput(raw: string) {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9-]/g, "")
  const digits = cleaned.replace(/\D/g, "")

  // Formato CR comun: 1-1234-5678
  if (digits.length === 9) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 9)}`
  }

  return cleaned
}

export function normalizePhoneInput(raw: string) {
  const digits = raw.replace(/\D/g, "").slice(0, 8)
  if (digits.length <= 4) return digits
  return `${digits.slice(0, 4)}-${digits.slice(4)}`
}

export function normalizeWeaponSerialInput(raw: string) {
  return raw.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 30)
}

export function isNoWeaponInPostValue(value: string) {
  return String(value ?? "").trim().toUpperCase() === NO_WEAPON_IN_POST_OPTION
}

export function toDateSafe(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value
  }
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === "function") {
      const d = candidate.toDate()
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

export function getSupervisionReportCode(report: Record<string, unknown>) {
  const date = toDateSafe(report.createdAt)
  const ymd = date
    ? `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`
    : "00000000"
  const idSuffix = String(report.id ?? "XXXXXX").replace(/[^a-zA-Z0-9]/g, "").slice(0, 6).toUpperCase() || "XXXXXX"
  return `BS-${ymd}-${idSuffix}`
}

export function getChecklistScore(report: Record<string, unknown>) {
  const checklist = (report.checklist as Record<string, unknown> | undefined) ?? {}
  const keys = ["uniform", "equipment", "punctuality", "service"]
  const passed = keys.filter((k) => checklist[k] === true).length
  const pct = Math.round((passed / keys.length) * 100)
  return { passed, total: keys.length, pct }
}

export function getExecutiveResult(report: Record<string, unknown>) {
  const status = String(report.status ?? "").toUpperCase()
  if (status.includes("CUMPLIM")) return "APROBADA"
  if (status.includes("NOVEDAD")) return "CON HALLAZGOS"
  return "EN REVISION"
}

export function formatSupervisionExportDateTime(value: unknown) {
  const date = toDateSafe(value)
  return date ? date.toLocaleString() : "—"
}

export function formatSupervisionYesNo(value: unknown) {
  return value === true ? "SI" : "NO"
}

export function getSupervisionChecklistReasonSummary(report: Record<string, unknown>) {
  return [
    (report.checklistReasons as Record<string, unknown> | undefined)?.uniform,
    (report.checklistReasons as Record<string, unknown> | undefined)?.equipment,
    (report.checklistReasons as Record<string, unknown> | undefined)?.punctuality,
    (report.checklistReasons as Record<string, unknown> | undefined)?.service,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" | ") || "—"
}

export function getSupervisionPropertySummary(report: Record<string, unknown>) {
  const property = (report.propertyDetails as Record<string, unknown> | undefined) ?? {}
  const parts = [
    `Luz: ${String(property.luz ?? "—")}`,
    `Perímetro: ${String(property.perimetro ?? "—")}`,
    `Sacate: ${String(property.sacate ?? "—")}`,
    `Daños: ${String(property.danosPropiedad ?? "—")}`,
  ]
  return parts.join(" | ")
}

export type SupervisionGpsPoint = {
  lat: number
  lng: number
  accuracy?: number
}

export function parseSupervisionGps(rawGps: unknown): SupervisionGpsPoint | null {
  const parseNumber = (value: unknown) => {
    if (typeof value === "number") return Number.isFinite(value) ? value : null
    if (typeof value === "string") {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? parsed : null
    }
    return null
  }

  const parseFromObject = (value: Record<string, unknown>) => {
    const lat = parseNumber(value.lat)
    const lng = parseNumber(value.lng)
    if (lat === null || lng === null) return null
    const accuracy = parseNumber(value.accuracy)
    return {
      lat,
      lng,
      ...(accuracy !== null ? { accuracy } : {}),
    }
  }

  if (!rawGps) return null
  if (typeof rawGps === "object") {
    return parseFromObject(rawGps as Record<string, unknown>)
  }
  if (typeof rawGps === "string") {
    try {
      const parsed = JSON.parse(rawGps) as Record<string, unknown>
      return parseFromObject(parsed)
    } catch {
      return null
    }
  }
  return null
}

export function getSupervisionGpsText(report: Record<string, unknown>) {
  const gps = parseSupervisionGps(report.gps)
  if (!gps) return "—"
  return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
}

export function getSupervisionGeoRiskSummary(report: Record<string, unknown>) {
  const geoRisk = (report.geoRisk as { riskLevel?: unknown; flags?: unknown; estimatedSpeedKmh?: unknown } | undefined) ?? {}
  const riskLevel = String(geoRisk.riskLevel ?? "sin dato").trim() || "sin dato"
  const flags = Array.isArray(geoRisk.flags) ? geoRisk.flags.map((item) => String(item).trim()).filter(Boolean) : []
  const speed = Number(geoRisk.estimatedSpeedKmh)
  return {
    riskLevel,
    flagsText: flags.join(" | ") || "Sin banderas",
    speedText: Number.isFinite(speed) ? `${speed.toFixed(1)} km/h` : "—",
    label: `${riskLevel.toUpperCase()}${flags.length ? ` | ${flags.join(", ")}` : ""}`,
  }
}

export function getSupervisionEvidenceSummary(report: Record<string, unknown>) {
  const evidence = (report.evidenceBundle as {
    capturedAt?: unknown
    user?: { email?: unknown; uid?: unknown } | null
    gps?: { lat?: unknown; lng?: unknown; accuracy?: unknown } | null
    photos?: unknown
  } | undefined) ?? {}
  const photoCount = Array.isArray(evidence.photos) ? evidence.photos.length : Array.isArray(report.photos) ? report.photos.length : 0
  const capturedAt = formatSupervisionExportDateTime(evidence.capturedAt)
  const actor = String(evidence.user?.email ?? evidence.user?.uid ?? report.supervisorId ?? "—")
  const gpsAccuracy = Number(evidence.gps?.accuracy)
  return {
    photoCount,
    capturedAt,
    actor,
    gpsAccuracy: Number.isFinite(gpsAccuracy) ? `${Math.round(gpsAccuracy)} m` : "—",
    summary: `Fotos: ${photoCount} | Captura: ${capturedAt} | Usuario: ${actor} | Precisión GPS: ${Number.isFinite(gpsAccuracy) ? `${Math.round(gpsAccuracy)} m` : "—"}`,
  }
}

export function getSupervisionExecutiveSummary(report: Record<string, unknown>) {
  const score = getChecklistScore(report)
  const geo = getSupervisionGeoRiskSummary(report)
  const evidence = getSupervisionEvidenceSummary(report)
  return `${getExecutiveResult(report)} | Cumplimiento ${score.pct}% (${score.passed}/${score.total}) | Riesgo GPS ${geo.riskLevel.toUpperCase()} | Evidencias ${evidence.photoCount}`
}

export function buildSupervisionPhotoFileName(report: Record<string, unknown> | null, index: number) {
  return `supervision-${getSupervisionReportCode(report ?? {})}-evidencia-${String(index + 1).padStart(2, "0")}.jpg`
}
