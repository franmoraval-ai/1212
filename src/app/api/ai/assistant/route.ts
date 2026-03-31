import { getOpenAITimeoutSignal, getOpenAIUrl } from "@/lib/openai-server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

const BASE_RECORDS_PER_TABLE = 40
const DEEP_RECORDS_PER_TABLE = 120
const REPORT_TIMEZONE = "America/Costa_Rica"

type Message = { role: "user" | "assistant"; content: string }
type AssistantContext = {
  operationTerm?: string
  supervisorTerm?: string
  postTerm?: string
  hourStart?: number
  hourEnd?: number
}

type RequestBody = {
  messages?: unknown[]
  context?: AssistantContext
}

type DatasetRow = Record<string, unknown>
type DatasetMap = Partial<Record<TableKey, DatasetRow[]>>

function normalizeTerm(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function resolveTermFromCandidates(raw: string, candidates: string[]) {
  const term = normalizeTerm(raw)
  if (!term) return ""
  const normalized = candidates.map((item) => ({ raw: item, norm: normalizeTerm(item) })).filter((item) => item.norm)
  const exact = normalized.find((item) => item.norm === term)
  if (exact) return exact.raw
  const contains = normalized.find((item) => item.norm.includes(term) || term.includes(item.norm))
  if (contains) return contains.raw
  const tokenMatch = normalized.find((item) => {
    const tokens = item.norm.split(/\s+/).filter(Boolean)
    return tokens.some((token) => token.length >= 3 && term.includes(token))
  })
  return tokenMatch?.raw ?? raw
}

// ── Detectar rango de fechas en el último mensaje ──────────────────────────────
function detectDateRange(text: string): { since: string; until: string } {
  const now = new Date()
  const t = text.toLowerCase()

  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

  if (t.includes("hoy") || t.includes("today")) {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end = new Date(now); end.setHours(23, 59, 59, 999)
    return { since: start.toISOString(), until: end.toISOString() }
  }
  if (t.includes("ayer") || t.includes("yesterday")) {
    const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setHours(23, 59, 59, 999)
    return { since: start.toISOString(), until: end.toISOString() }
  }
  if (t.includes("esta semana") || t.includes("this week")) return { since: daysAgo(7), until: now.toISOString() }
  if (t.includes("semana pasada") || t.includes("last week")) return { since: daysAgo(14), until: daysAgo(7) }
  if (t.includes("este mes") || t.includes("this month")) return { since: daysAgo(30), until: now.toISOString() }
  if (t.includes("mes pasado") || t.includes("last month")) return { since: daysAgo(60), until: daysAgo(30) }

  // Detectar fecha explícita tipo "15 de marzo", "marzo 15", "15/03"
  const monthNames: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  }
  for (const [name, idx] of Object.entries(monthNames)) {
    const match = new RegExp(`(\\d{1,2})\\s+de\\s+${name}|${name}\\s+(\\d{1,2})`).exec(t)
    if (match) {
      const day = Number(match[1] ?? match[2])
      const year = now.getFullYear()
      const start = new Date(year, idx, day, 0, 0, 0)
      const end = new Date(year, idx, day, 23, 59, 59)
      return { since: start.toISOString(), until: end.toISOString() }
    }
  }
  // Formato dd/mm
  const dmMatch = /(\d{1,2})\/(\d{1,2})/.exec(t)
  if (dmMatch) {
    const [, d, m] = dmMatch
    const start = new Date(now.getFullYear(), Number(m) - 1, Number(d), 0, 0, 0)
    const end = new Date(now.getFullYear(), Number(m) - 1, Number(d), 23, 59, 59)
    return { since: start.toISOString(), until: end.toISOString() }
  }

  // Default: últimos 30 días
  return { since: daysAgo(30), until: now.toISOString() }
}

// ── Detectar qué módulos son relevantes ───────────────────────────────────────
type TableKey =
  | "supervisions"
  | "round_reports"
  | "incidents"
  | "visitors"
  | "weapon_control_logs"
  | "internal_notes"
  | "management_audits"
  | "alerts"
  | "round_sessions"
  | "round_checkpoint_events"
  | "rounds"
  | "operation_catalog"

function detectRelevantTables(text: string): TableKey[] {
  const t = text.toLowerCase()
  const all: TableKey[] = [
    "supervisions",
    "round_reports",
    "incidents",
    "visitors",
    "weapon_control_logs",
    "internal_notes",
    "management_audits",
    "alerts",
    "round_sessions",
    "round_checkpoint_events",
    "rounds",
    "operation_catalog",
  ]

  const matchers: [TableKey, string[]][] = [
    ["supervisions",       ["supervis", "fiscali", "oficial", "boleta de supervis"]],
    ["round_reports",      ["ronda", "round", "checkpoint", "recorrido", "patrullaje"]],
    ["incidents",          ["incident", "novedad", "event", "accidente", "reporte"]],
    ["visitors",           ["visita", "visitor", "ingreso", "entrada", "acceso", "invitado"]],
    ["weapon_control_logs",["arma", "weapon", "pistola", "fusil", "control de arma", "serie"]],
    ["internal_notes",     ["nota", "note", "interno", "comunicado", "aviso", "memo"]],
    ["management_audits",  ["auditoria", "auditoría", "gerencial", "evaluacion", "evaluación"]],
    ["alerts",             ["alerta", "alertas", "riesgo", "fraude"]],
    ["round_sessions",     ["sesion de ronda", "sesión de ronda", "sesion", "sesión", "en progreso"]],
    ["round_checkpoint_events", ["checkpoint event", "eventos checkpoint", "salto gps", "geofence"]],
    ["rounds",             ["definicion de ronda", "definición de ronda", "ronda activa", "puesto base"]],
    ["operation_catalog",  ["catalogo de operaciones", "catálogo de operaciones", "operaciones activas", "clientes"]],
  ]

  const matched = matchers.filter(([, terms]) => terms.some((term) => t.includes(term))).map(([key]) => key)
  if (matched.length > 0) return matched

  const genericTerms = ["resumen", "todo", "general", "todos", "cuantos", "dame", "qué pasó", "novedades", "reporte", "hoy", "ayer", "semana", "mes"]
  if (genericTerms.some((g) => t.includes(g))) return all

  return matched.length > 0 ? matched : all
}

function isDeepAnalysisQuery(text: string) {
  const t = text.toLowerCase()
  const deepTerms = ["analisis profundo", "análisis profundo", "detallado", "exhaustivo", "causa", "tendencia", "patron", "patrón", "riesgo"]
  return deepTerms.some((term) => t.includes(term))
}

function extractOperationTerm(text: string) {
  const t = text.toLowerCase()
  const match = /operaci[oó]n(?:\s+|:)([a-z0-9áéíóúñ\s\-]{2,40})/i.exec(t)
  if (!match?.[1]) return ""
  return String(match[1]).trim().replace(/\s+/g, " ")
}

function extractSupervisorTerm(text: string) {
  const t = text.toLowerCase()
  const match = /supervisor(?:a)?(?:\s+de)?(?:\s+nombre)?(?:\s+|:)([a-z0-9áéíóúñ.\-]+(?:\s+[a-z0-9áéíóúñ.\-]+){0,2})/i.exec(t)
  if (!match?.[1]) return ""
  return String(match[1]).trim().replace(/\s+/g, " ")
}

function extractPostTerm(text: string) {
  const t = text.toLowerCase()
  const match = /puesto(?:\s+|:)([a-z0-9áéíóúñ.\-\s]{2,40})/i.exec(t)
  if (!match?.[1]) return ""
  return String(match[1]).trim().replace(/\s+/g, " ")
}

function isStatsQuery(text: string) {
  const t = text.toLowerCase()
  const statsTerms = ["estadistica", "estadísticas", "detalle", "detalles", "que esta pasando", "qué está pasando", "tendencia", "totales", "cuantas", "cuántas"]
  return statsTerms.some((term) => t.includes(term))
}

function parseHourWithAmPm(rawHour: string, ampmRaw?: string | null) {
  let hour = Math.max(0, Math.min(23, Number(rawHour)))
  const ampm = String(ampmRaw ?? "").trim().toLowerCase()
  if (ampm === "pm" && hour < 12) hour += 12
  if (ampm === "am" && hour === 12) hour = 0
  return hour
}

function extractHourRange(text: string): { startHour: number; endHour: number } | null {
  const t = text.toLowerCase()
  const rangeMatch = /(?:entre|de)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:a|-)\s*(?:las\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(t)
  if (rangeMatch) {
    const startHour = parseHourWithAmPm(rangeMatch[1], rangeMatch[3] ?? null)
    const endHour = parseHourWithAmPm(rangeMatch[4], rangeMatch[6] ?? rangeMatch[3] ?? null)
    return { startHour, endHour }
  }
  const singleMatch = /(?:a las|hora|h)\s*(\d{1,2})(?::\d{2})?\s*(am|pm)?/i.exec(t)
  if (singleMatch) {
    const h = parseHourWithAmPm(singleMatch[1], singleMatch[2] ?? null)
    return { startHour: h, endHour: h }
  }
  return null
}

function getTableTimeField(table: TableKey): string {
  if (table === "incidents") return "time"
  if (table === "visitors") return "entry_time"
  if (table === "round_reports") return "started_at"
  if (table === "round_sessions") return "started_at"
  if (table === "round_checkpoint_events") return "captured_at"
  return "created_at"
}

function getHourInReportTimezone(value: unknown): number | null {
  const raw = String(value ?? "").trim()
  if (!raw) return null
  const dt = new Date(raw)
  if (Number.isNaN(dt.getTime())) return null
  const hourText = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    timeZone: REPORT_TIMEZONE,
  }).format(dt)
  const hour = Number(hourText)
  return Number.isFinite(hour) ? hour : null
}

function getTableLabel(table: TableKey) {
  const labels: Record<TableKey, string> = {
    supervisions: "Supervisiones",
    round_reports: "Rondas (boletas)",
    incidents: "Incidentes",
    visitors: "Visitantes",
    weapon_control_logs: "Control de armas",
    internal_notes: "Notas internas",
    management_audits: "Auditorías",
    alerts: "Alertas",
    round_sessions: "Sesiones de ronda",
    round_checkpoint_events: "Eventos checkpoint",
    rounds: "Definiciones de ronda",
    operation_catalog: "Catálogo operaciones",
  }
  return labels[table]
}

function hasConfirmation(text: string) {
  const t = text.toLowerCase()
  return t.includes("confirmar") || t.includes("confirmado")
}

function extractUuid(text: string) {
  const match = /([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i.exec(text)
  return match?.[1] ? String(match[1]).trim() : ""
}

function parseTokens(raw: string | null | undefined) {
  return String(raw ?? "")
    .split(/[|,;]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeScopeValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function matchesIdentity(value: unknown, identityTokens: string[]) {
  const normalized = normalizeScopeValue(value)
  return normalized.length > 0 && identityTokens.includes(normalized)
}

function matchesAssigned(value: unknown, assignedTokens: string[]) {
  const normalized = normalizeScopeValue(value)
  return normalized.length > 0 && assignedTokens.some((token) => token && normalized.includes(token))
}

function rowMatchesScope(
  table: TableKey,
  row: Record<string, unknown>,
  assignedTokens: string[],
  identityTokens: string[],
) {
  switch (table) {
    case "supervisions":
      return (
        matchesIdentity(row.supervisor_id, identityTokens) ||
        matchesAssigned(row.review_post, assignedTokens) ||
        matchesAssigned(row.operation_name, assignedTokens)
      )
    case "round_reports":
      return (
        matchesIdentity(row.officer_id, identityTokens) ||
        matchesAssigned(row.post_name, assignedTokens) ||
        matchesAssigned(row.round_name, assignedTokens)
      )
    case "incidents":
      return (
        matchesIdentity(row.reported_by_user_id, identityTokens) ||
        matchesIdentity(row.reported_by_email, identityTokens) ||
        matchesAssigned(row.location ?? row.lugar, assignedTokens)
      )
    case "visitors":
      return matchesAssigned(row.visited_person ?? row.destination ?? row.post, assignedTokens)
    case "weapon_control_logs":
      return (
        matchesIdentity(row.changed_by_user_id, identityTokens) ||
        matchesIdentity(row.changed_by_email, identityTokens)
      )
    case "internal_notes":
      return (
        matchesIdentity(row.reported_by_user_id, identityTokens) ||
        matchesIdentity(row.reported_by_email, identityTokens) ||
        matchesAssigned(row.post_name, assignedTokens)
      )
    case "management_audits":
      return (
        matchesIdentity(row.officer_id, identityTokens) ||
        matchesAssigned(row.post_name, assignedTokens) ||
        matchesAssigned(row.operation_name, assignedTokens)
      )
    case "alerts":
      return matchesIdentity(row.user_id, identityTokens) || matchesIdentity(row.user_email, identityTokens)
    case "round_sessions":
      return (
        matchesIdentity(row.officer_id, identityTokens) ||
        matchesAssigned(row.post_name, assignedTokens) ||
        matchesAssigned(row.round_name, assignedTokens)
      )
    case "round_checkpoint_events":
      return matchesAssigned(row.checkpoint_name ?? row.checkpoint_id, assignedTokens)
    case "rounds":
      return matchesAssigned(row.post ?? row.puesto_base, assignedTokens)
    case "operation_catalog":
      return matchesAssigned(row.operation_name, assignedTokens) || matchesAssigned(row.client_name, assignedTokens)
    default:
      return false
  }
}

function normalizeMessages(raw: unknown[]): Message[] {
  return raw
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const msg = m as Record<string, unknown>
      const role: "user" | "assistant" = String(msg.role ?? "user") === "assistant" ? "assistant" : "user"
      return { role, content: String(msg.content ?? "").trim() }
    })
    .filter((m) => m.content.length > 0)
    .slice(-10)
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

function formatRowDate(row: DatasetRow) {
  return formatDate(String(row.created_at ?? ""))
}

function buildDataContext(data: DatasetMap, lineLimitPerTable: number) {
  const lines: string[] = []

  if (data.supervisions?.length) {
    lines.push(`\n## SUPERVISIONES (${data.supervisions.length} registros)`)
    for (const r of data.supervisions.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Supervisor: ${r.supervisor_name ?? r.supervisor_id ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Puesto: ${r.review_post ?? "-"} | Op: ${r.operation_name ?? "-"} | Estado: ${r.status ?? "-"} | Obs: ${r.observations ?? "-"}`
      )
    }
  }

  if (data.round_reports?.length) {
    lines.push(`\n## RONDAS (${data.round_reports.length} registros)`)
    for (const r of data.round_reports.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Ronda: ${r.round_name ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Estado: ${r.status ?? "-"} | Avance: ${r.checkpoints_completed ?? 0}/${r.checkpoints_total ?? 0} | Notas: ${r.notes ?? "-"}`
      )
    }
  }

  if (data.incidents?.length) {
    lines.push(`\n## INCIDENTES (${data.incidents.length} registros)`)
    for (const r of data.incidents.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Tipo: ${r.incident_type ?? r.title ?? "-"} | Lugar: ${r.location ?? r.lugar ?? "-"} | Estado: ${r.status ?? "-"} | Desc: ${String(r.description ?? "-").slice(0, 120)}`
      )
    }
  }

  if (data.visitors?.length) {
    lines.push(`\n## VISITANTES (${data.visitors.length} registros)`)
    for (const r of data.visitors.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Nombre: ${r.name ?? r.visitor_name ?? "-"} | Destino: ${r.destination ?? r.post ?? "-"} | Estado: ${r.status ?? "-"}`
      )
    }
  }

  if (data.weapon_control_logs?.length) {
    lines.push(`\n## CONTROL DE ARMAS (${data.weapon_control_logs.length} registros)`)
    for (const r of data.weapon_control_logs.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Arma: ${r.weapon_model ?? "-"} | Serie: ${r.weapon_serial ?? "-"} | Responsable: ${r.changed_by_name ?? r.changed_by_email ?? "-"} | Motivo: ${r.reason ?? "-"}`
      )
    }
  }

  if (data.internal_notes?.length) {
    lines.push(`\n## NOTAS INTERNAS (${data.internal_notes.length} registros)`)
    for (const r of data.internal_notes.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Puesto: ${r.post_name ?? "-"} | Categoría: ${r.category ?? "-"} | Estado: ${r.status ?? "-"} | Nota: ${String(r.detail ?? "-").slice(0, 100)}`
      )
    }
  }

  if (data.management_audits?.length) {
    lines.push(`\n## AUDITORÍAS GERENCIALES (${data.management_audits.length} registros)`)
    for (const r of data.management_audits.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Operación: ${r.operation_name ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Puesto: ${r.post_name ?? "-"} | Hallazgos: ${String(r.findings ?? "-").slice(0, 100)}`
      )
    }
  }

  if (data.alerts?.length) {
    lines.push(`\n## ALERTAS (${data.alerts.length} registros)`)
    for (const r of data.alerts.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Tipo: ${r.type ?? "-"} | Mensaje: ${String(r.message ?? "-").slice(0, 120)}`
      )
    }
  }

  if (data.round_sessions?.length) {
    lines.push(`\n## SESIONES DE RONDA (${data.round_sessions.length} registros)`)
    for (const r of data.round_sessions.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Ronda: ${r.round_name ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Estado: ${r.status ?? "-"} | Avance: ${r.checkpoints_completed ?? 0}/${r.checkpoints_total ?? 0} | Fraude score: ${r.fraud_score ?? 0}`
      )
    }
  }

  if (data.round_checkpoint_events?.length) {
    lines.push(`\n## EVENTOS CHECKPOINT (${data.round_checkpoint_events.length} registros)`)
    for (const r of data.round_checkpoint_events.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Checkpoint: ${r.checkpoint_name ?? r.checkpoint_id ?? "-"} | Tipo: ${r.event_type ?? "-"} | Fraude: ${r.fraud_flag ?? "-"}`
      )
    }
  }

  if (data.rounds?.length) {
    lines.push(`\n## DEFINICIONES DE RONDA (${data.rounds.length} registros)`)
    for (const r of data.rounds.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Ronda: ${r.name ?? "-"} | Puesto: ${r.post ?? r.puesto_base ?? "-"} | Estado: ${r.status ?? "-"} | Frecuencia: ${r.frequency ?? "-"}`
      )
    }
  }

  if (data.operation_catalog?.length) {
    lines.push(`\n## CATÁLOGO DE OPERACIONES (${data.operation_catalog.length} registros)`)
    for (const r of data.operation_catalog.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatRowDate(r)}] Operación: ${r.operation_name ?? "-"} | Cliente: ${r.client_name ?? "-"} | Activa: ${r.is_active ? "Sí" : "No"}`
      )
    }
  }

  return lines.length ? lines.join("\n") : "No hay datos disponibles para el período consultado."
}

function buildDatasetStats(
  data: DatasetMap,
  totals?: Partial<Record<TableKey, number>>,
) {
  const lines: string[] = ["RESUMEN ESTADÍSTICO:"]

  const addStatusSummary = (label: string, key: TableKey, rows: DatasetRow[]) => {
    if (!rows?.length) return
    const statusCount = new Map<string, number>()
    for (const row of rows) {
      const statusKey = String(row?.status ?? row?.action ?? row?.type ?? "SIN_CLASIFICAR").trim().toUpperCase()
      statusCount.set(statusKey, (statusCount.get(statusKey) ?? 0) + 1)
    }
    const top = Array.from(statusCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
    const total = Number(totals?.[key] ?? rows.length)
    lines.push(`- ${label}: ${total} registros (${top || "sin desglose"})`)
  }

  addStatusSummary("Supervisiones", "supervisions", data.supervisions ?? [])
  addStatusSummary("Rondas", "round_reports", data.round_reports ?? [])
  addStatusSummary("Incidentes", "incidents", data.incidents ?? [])
  addStatusSummary("Visitantes", "visitors", data.visitors ?? [])
  addStatusSummary("Control de armas", "weapon_control_logs", data.weapon_control_logs ?? [])
  addStatusSummary("Notas internas", "internal_notes", data.internal_notes ?? [])
  addStatusSummary("Auditorías", "management_audits", data.management_audits ?? [])
  addStatusSummary("Alertas", "alerts", data.alerts ?? [])
  addStatusSummary("Sesiones de ronda", "round_sessions", data.round_sessions ?? [])
  addStatusSummary("Eventos checkpoint", "round_checkpoint_events", data.round_checkpoint_events ?? [])
  addStatusSummary("Definiciones de ronda", "rounds", data.rounds ?? [])
  addStatusSummary("Catálogo operaciones", "operation_catalog", data.operation_catalog ?? [])

  return lines.join("\n")
}

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return new Response(JSON.stringify({ error: error ?? "No autenticado." }), { status })
    }

    const actorRoleLevel = Number(actor.roleLevel ?? 1)
    if (actorRoleLevel < 2) {
      return new Response(JSON.stringify({ error: "Asistente IA disponible solo para L2/L3/L4." }), { status: 403 })
    }

    const body = (await request.json()) as RequestBody
    const messages = normalizeMessages(Array.isArray(body.messages) ? body.messages : [])
    if (!messages.length) return new Response(JSON.stringify({ error: "Sin mensajes." }), { status: 400 })
    const context = body.context && typeof body.context === "object" ? body.context : {}

    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
    if (!apiKey || apiKey === "TU_OPENAI_API_KEY_AQUI") {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY no configurada." }), { status: 500 })
    }

    // ── Detectar período y módulos relevantes desde el último mensaje ──────────
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
    const { since, until } = detectDateRange(lastUserMsg)
    const relevantTables = detectRelevantTables(lastUserMsg)
    const deepAnalysis = isDeepAnalysisQuery(lastUserMsg)
    const statsQuery = isStatsQuery(lastUserMsg)
    const operationTermRaw = extractOperationTerm(lastUserMsg) || String(context.operationTerm ?? "")
    const supervisorTermRaw = extractSupervisorTerm(lastUserMsg) || String(context.supervisorTerm ?? "")
    const postTermRaw = extractPostTerm(lastUserMsg) || String(context.postTerm ?? "")
    const parsedHourRange = extractHourRange(lastUserMsg)
    const hourRange = parsedHourRange ?? (
      Number.isFinite(Number(context.hourStart)) && Number.isFinite(Number(context.hourEnd))
        ? { startHour: Number(context.hourStart), endHour: Number(context.hourEnd) }
        : null
    )
    const isConfirmedAction = hasConfirmation(lastUserMsg)
    const recordsLimit = deepAnalysis ? DEEP_RECORDS_PER_TABLE : BASE_RECORDS_PER_TABLE
    const lineLimitPerTable = deepAnalysis ? 25 : 12

    // ── Agente operativo: ejecutar acciones con control de riesgo ───────────────
    const lowMsg = lastUserMsg.toLowerCase()
    const actionResponse = (text: string) =>
      new Response(text, { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8" } })

    // Bajo riesgo (auto): crear nota interna
    if (lowMsg.includes("crear nota interna") || lowMsg.includes("nueva nota interna") || lowMsg.includes("registrar nota interna")) {
      const priorityMatch = /(prioridad|priority)\s*[:\-]?\s*(alta|media|baja)/i.exec(lastUserMsg)
      const categoryMatch = /(categoria|categoría)\s*[:\-]?\s*([a-záéíóúñ\s]{3,30})/i.exec(lastUserMsg)
      const detailMatch = /(detalle|nota)\s*[:\-]\s*(.+)$/i.exec(lastUserMsg)
      const detail = String(detailMatch?.[2] ?? lastUserMsg).trim()
      if (detail.length < 8) {
        return actionResponse("Para crear la nota necesito más detalle. Ejemplo: crear nota interna puesto principal prioridad alta detalle: Puerta lateral sin sello.")
      }

      const payload = {
        post_name: postTermRaw || null,
        category: String(categoryMatch?.[2] ?? "Operativa").trim(),
        priority: String(priorityMatch?.[2] ?? "media").trim().toLowerCase(),
        detail,
        status: "abierta",
        reported_by_user_id: actor.uid,
        reported_by_name: String(actor.firstName ?? actor.email).trim() || actor.email,
        reported_by_email: actor.email,
      }
      const { error } = await admin.from("internal_notes").insert(payload)
      if (error) return actionResponse(`No pude crear la nota interna: ${String(error.message ?? "error desconocido")}`)
      return actionResponse("✅ Nota interna creada correctamente.")
    }

    // Bajo riesgo (auto): registrar visitante
    if (lowMsg.includes("registrar visitante") || lowMsg.includes("crear visitante")) {
      if (actorRoleLevel < 3) {
        return actionResponse("Solo L3/L4 pueden registrar visitantes desde el asistente IA.")
      }
      const nameMatch = /visitante\s*[:\-]?\s*([a-záéíóúñ\s]{3,60})/i.exec(lastUserMsg)
      const docMatch = /(documento|cedula|cédula)\s*[:\-]?\s*([a-z0-9\-]{4,30})/i.exec(lastUserMsg)
      const personMatch = /(visita a|destino)\s*[:\-]?\s*([a-z0-9áéíóúñ\s\-]{3,60})/i.exec(lastUserMsg)
      const visitorName = String(nameMatch?.[1] ?? "").trim()
      if (!visitorName) {
        return actionResponse("Para registrar visitante necesito al menos el nombre. Ejemplo: registrar visitante: Juan Pérez documento: 1-2345-6789 visita a: Operación Delta.")
      }
      const { error } = await admin.from("visitors").insert({
        name: visitorName,
        document_id: String(docMatch?.[2] ?? "").trim() || null,
        visited_person: String(personMatch?.[2] ?? "").trim() || null,
        entry_time: new Date().toISOString(),
      })
      if (error) return actionResponse(`No pude registrar visitante: ${String(error.message ?? "error desconocido")}`)
      return actionResponse("✅ Visitante registrado correctamente.")
    }

    // Crítico: actualizar supervisión
    if (lowMsg.includes("actualizar supervision") || lowMsg.includes("actualizar supervisión") || lowMsg.includes("cambiar supervision") || lowMsg.includes("cambiar supervisión")) {
      if (!isDirector(actor)) {
        return actionResponse("Solo L4 puede actualizar supervisiones desde el asistente IA.")
      }
      const supervisionId = extractUuid(lastUserMsg)
      const statusMatch = /estado\s*[:\-]?\s*(cumplim|con novedad|cerrad[ao]|abiert[ao])/i.exec(lastUserMsg)
      if (!supervisionId || !statusMatch?.[1]) {
        return actionResponse("Para actualizar supervisión necesito ID y estado. Ejemplo: actualizar supervisión <uuid> estado: CON NOVEDAD.")
      }
      if (!isConfirmedAction) {
        return actionResponse("⚠️ Acción crítica detectada. Para ejecutar, repite el comando incluyendo la palabra CONFIRMAR.")
      }
      const nextStatus = String(statusMatch[1]).toUpperCase()
      const { error } = await admin.from("supervisions").update({ status: nextStatus }).eq("id", supervisionId)
      if (error) return actionResponse(`No pude actualizar la supervisión: ${String(error.message ?? "error desconocido")}`)
      return actionResponse(`✅ Supervisión actualizada a ${nextStatus}.`)
    }

    // Crítico: actualizar ronda reporte
    if (lowMsg.includes("actualizar ronda") || lowMsg.includes("actualizar boleta de ronda")) {
      if (!isDirector(actor)) {
        return actionResponse("Solo L4 puede actualizar boletas de ronda desde el asistente IA.")
      }
      const reportId = extractUuid(lastUserMsg)
      const statusMatch = /estado\s*[:\-]?\s*(completad[ao]|incomplet[ao]|con novedad|cumplida|incumplida)/i.exec(lastUserMsg)
      if (!reportId || !statusMatch?.[1]) {
        return actionResponse("Para actualizar ronda necesito ID y estado. Ejemplo: actualizar ronda <uuid> estado: COMPLETADA.")
      }
      if (!isConfirmedAction) {
        return actionResponse("⚠️ Acción crítica detectada. Para ejecutar, repite el comando incluyendo la palabra CONFIRMAR.")
      }
      const nextStatus = String(statusMatch[1]).toUpperCase()
      const { error } = await admin.from("round_reports").update({ status: nextStatus }).eq("id", reportId)
      if (error) return actionResponse(`No pude actualizar la ronda: ${String(error.message ?? "error desconocido")}`)
      return actionResponse(`✅ Boleta de ronda actualizada a ${nextStatus}.`)
    }

    // Crítico: control de armas (log de cambio)
    if (lowMsg.includes("registrar control de arma") || lowMsg.includes("actualizar arma")) {
      if (!isDirector(actor)) {
        return actionResponse("Solo L4 puede registrar controles de arma desde el asistente IA.")
      }
      const serialMatch = /(serie|serial)\s*[:\-]?\s*([a-z0-9\-]{3,40})/i.exec(lastUserMsg)
      const reasonMatch = /(motivo|razon|razón)\s*[:\-]?\s*(.+)$/i.exec(lastUserMsg)
      const serial = String(serialMatch?.[2] ?? "").trim()
      if (!serial) return actionResponse("Para control de arma necesito serie/serial. Ejemplo: registrar control de arma serie: ABC123 motivo: entrega a turno noche.")
      if (!isConfirmedAction) {
        return actionResponse("⚠️ Acción crítica detectada. Para ejecutar, repite el comando incluyendo la palabra CONFIRMAR.")
      }
      const { data: weapon, error: weaponErr } = await admin.from("weapons").select("id,model,serial,status,assigned_to,ammo_count").ilike("serial", serial).limit(1).maybeSingle()
      if (weaponErr || !weapon?.id) return actionResponse("No encontré el arma por serial para registrar control.")
      const { error } = await admin.from("weapon_control_logs").insert({
        weapon_id: weapon.id,
        weapon_serial: weapon.serial,
        weapon_model: weapon.model,
        changed_by_user_id: actor.uid,
        changed_by_email: actor.email,
        changed_by_name: String(actor.firstName ?? actor.email).trim() || actor.email,
        reason: String(reasonMatch?.[2] ?? "Actualización por asistente IA").trim(),
        previous_data: weapon,
        new_data: weapon,
      })
      if (error) return actionResponse(`No pude registrar control de arma: ${String(error.message ?? "error desconocido")}`)
      return actionResponse("✅ Control de arma registrado en bitácora.")
    }

    // Crítico: salida de visitante
    if (lowMsg.includes("marcar salida visitante") || lowMsg.includes("cerrar visita")) {
      if (!isDirector(actor)) {
        return actionResponse("Solo L4 puede cerrar visitas desde el asistente IA.")
      }
      const nameMatch = /visitante\s*[:\-]?\s*([a-záéíóúñ\s]{3,60})/i.exec(lastUserMsg)
      const visitorName = String(nameMatch?.[1] ?? "").trim()
      if (!visitorName) return actionResponse("Para marcar salida necesito nombre del visitante. Ejemplo: marcar salida visitante: Juan Pérez.")
      if (!isConfirmedAction) {
        return actionResponse("⚠️ Acción crítica detectada. Para ejecutar, repite el comando incluyendo la palabra CONFIRMAR.")
      }
      const { error } = await admin
        .from("visitors")
        .update({ exit_time: new Date().toISOString() })
        .ilike("name", visitorName)
        .is("exit_time", null)
      if (error) return actionResponse(`No pude marcar salida del visitante: ${String(error.message ?? "error desconocido")}`)
      return actionResponse("✅ Salida del visitante registrada.")
    }

    // ── Consultar solo las tablas necesarias en paralelo ───────────────────────
    const assignedTokens = parseTokens(String(actor.assigned ?? ""))
    const identityTokens = [
      actor.uid.toLowerCase(),
      actor.email.toLowerCase(),
    ].filter(Boolean)

    const { data: usersRows } = await admin
      .from("users")
      .select("id,email,first_name")
      .limit(2000)
    const { data: operationCatalogRows } = await admin
      .from("operation_catalog")
      .select("operation_name")
      .eq("is_active", true)
      .limit(2000)
    const { data: roundsRows } = await admin
      .from("rounds")
      .select("post,puesto_base")
      .limit(2000)
    const supervisorLookup = new Map<string, string>()
    const supervisorNames: string[] = []
    for (const userRow of (usersRows ?? []) as Array<Record<string, unknown>>) {
      const firstName = String(userRow.first_name ?? "").trim()
      const id = String(userRow.id ?? "").trim().toLowerCase()
      const email = String(userRow.email ?? "").trim().toLowerCase()
      if (id && firstName) supervisorLookup.set(id, firstName)
      if (email && firstName) supervisorLookup.set(email, firstName)
      if (firstName) supervisorNames.push(firstName)
    }
    const operationCandidates = (operationCatalogRows ?? [])
      .map((row) => String((row as Record<string, unknown>).operation_name ?? "").trim())
      .filter(Boolean)
    const postCandidates = (roundsRows ?? [])
      .flatMap((row) => [String((row as Record<string, unknown>).post ?? "").trim(), String((row as Record<string, unknown>).puesto_base ?? "").trim()])
      .filter(Boolean)
    const operationTerm = resolveTermFromCandidates(operationTermRaw, operationCandidates)
    const supervisorTerm = resolveTermFromCandidates(supervisorTermRaw, supervisorNames)
    const postTerm = resolveTermFromCandidates(postTermRaw, postCandidates)

    const rowMatchesOperation = (row: Record<string, unknown>) => {
      if (!operationTerm) return true
      const text = Object.values(row)
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ")
      return text.includes(operationTerm)
    }

    const rowMatchesSupervisor = (row: Record<string, unknown>) => {
      if (!supervisorTerm) return true
      const text = Object.values(row)
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ")
      return text.includes(supervisorTerm)
    }

    const rowMatchesPost = (row: Record<string, unknown>) => {
      if (!postTerm) return true
      const text = Object.values(row)
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ")
      return text.includes(postTerm)
    }

    const rowMatchesHour = (row: Record<string, unknown>, table: TableKey) => {
      if (!hourRange) return true
      const timeField = getTableTimeField(table)
      const hour = getHourInReportTimezone(row[timeField] ?? row.created_at)
      if (hour === null) return false
      if (hourRange.startHour <= hourRange.endHour) {
        return hour >= hourRange.startHour && hour <= hourRange.endHour
      }
      return hour >= hourRange.startHour || hour <= hourRange.endHour
    }

    const applyRowFilters = (rows: Record<string, unknown>[], table: TableKey) => {
      const bypassScope = actorRoleLevel >= 3 && table !== "management_audits"
      const scopedRows = bypassScope
        ? rows
        : rows.filter((row) => rowMatchesScope(table, row, assignedTokens, identityTokens))
      const byOperation = scopedRows.filter(rowMatchesOperation)
      const byPost = byOperation.filter(rowMatchesPost)
      const byHour = byPost.filter((row) => rowMatchesHour(row, table))
      if (table === "supervisions") return byHour.filter(rowMatchesSupervisor)
      return byHour
    }

    const q = async (table: TableKey, fields: string): Promise<unknown[]> => {
      const timeField = getTableTimeField(table)
      const selectedFields = fields.split(",").map((f) => f.trim()).filter(Boolean)
      if (!selectedFields.includes("created_at")) selectedFields.unshift("created_at")
      if (!selectedFields.includes(timeField)) selectedFields.push(timeField)
      const queryFields = selectedFields.join(",")
      const fetchLimit = actorRoleLevel >= 3 ? recordsLimit : Math.max(recordsLimit * 3, 200)
      const { data } = await admin
        .from(table)
        .select(queryFields)
        .gte(timeField, since)
        .lte(timeField, until)
        .order(timeField, { ascending: false })
        .limit(fetchLimit)
      const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
        if (table !== "supervisions") return row
        const supervisorId = String(row.supervisor_id ?? "").trim().toLowerCase()
        const supervisorName = supervisorLookup.get(supervisorId) ?? ""
        return supervisorName ? { ...row, supervisor_name: supervisorName } : row
      })
      return applyRowFilters(rows, table).slice(0, recordsLimit)
    }

    const tableQueries: Record<TableKey, () => Promise<unknown[]>> = {
      supervisions:        () => q("supervisions",        "created_at,supervisor_id,officer_name,review_post,operation_name,status,observations"),
      round_reports:       () => q("round_reports",       "created_at,round_name,officer_name,status,checkpoints_completed,checkpoints_total,notes"),
      incidents:           () => q("incidents",           "created_at,incident_type,title,location,lugar,status,description,reported_by_user_id,reported_by_email"),
      visitors:            () => q("visitors",            "created_at,name,visitor_name,destination,post,status"),
      weapon_control_logs: () => q("weapon_control_logs", "created_at,weapon_model,weapon_serial,changed_by_name,changed_by_email,changed_by_user_id,reason"),
      internal_notes:      () => q("internal_notes",      "created_at,post_name,category,status,detail,reported_by_user_id,reported_by_email,reported_by_name,assigned_to"),
      management_audits:   () => q("management_audits",   "created_at,operation_name,officer_name,post_name,findings,action_plan"),
      alerts:              () => q("alerts",              "created_at,type,message,user_email"),
      round_sessions:      () => q("round_sessions",      "created_at,round_name,post_name,officer_name,status,checkpoints_total,checkpoints_completed,fraud_score"),
      round_checkpoint_events: () => q("round_checkpoint_events", "created_at,checkpoint_id,checkpoint_name,event_type,fraud_flag"),
      rounds:              () => q("rounds",              "created_at,name,post,puesto_base,status,frequency"),
      operation_catalog:   () => q("operation_catalog",   "created_at,operation_name,client_name,is_active"),
    }

    const countTableRows = async (table: TableKey, fields: string) => {
      const timeField = getTableTimeField(table)
      const selectedFields = fields.split(",").map((f) => f.trim()).filter(Boolean)
      if (!selectedFields.includes("created_at")) selectedFields.unshift("created_at")
      if (!selectedFields.includes(timeField)) selectedFields.push(timeField)
      const queryFields = selectedFields.join(",")
      const pageSize = 1000
      let from = 0
      let total = 0
      while (true) {
        const { data } = await admin
          .from(table)
          .select(queryFields)
          .gte(timeField, since)
          .lte(timeField, until)
          .order(timeField, { ascending: false })
          .range(from, from + pageSize - 1)
        const rows = (data ?? []) as unknown as Record<string, unknown>[]
        const normalizedRows = rows.map((row) => {
          if (table !== "supervisions") return row
          const supervisorId = String(row.supervisor_id ?? "").trim().toLowerCase()
          const supervisorName = supervisorLookup.get(supervisorId) ?? ""
          return supervisorName ? { ...row, supervisor_name: supervisorName } : row
        })
        if (rows.length === 0) break
        total += applyRowFilters(normalizedRows, table).length
        if (rows.length < pageSize) break
        from += pageSize
      }
      return total
    }

    const countQueries: Record<TableKey, () => Promise<number>> = {
      supervisions:        () => countTableRows("supervisions", "created_at,supervisor_id,officer_name,review_post,operation_name,status,observations"),
      round_reports:       () => countTableRows("round_reports", "created_at,round_name,officer_name,status,checkpoints_completed,checkpoints_total,notes"),
      incidents:           () => countTableRows("incidents", "created_at,incident_type,title,location,lugar,status,description,reported_by_user_id,reported_by_email"),
      visitors:            () => countTableRows("visitors", "created_at,name,visitor_name,destination,post,status"),
      weapon_control_logs: () => countTableRows("weapon_control_logs", "created_at,weapon_model,weapon_serial,changed_by_name,changed_by_email,changed_by_user_id,reason"),
      internal_notes:      () => countTableRows("internal_notes", "created_at,post_name,category,status,detail,reported_by_user_id,reported_by_email,reported_by_name,assigned_to"),
      management_audits:   () => countTableRows("management_audits", "created_at,operation_name,officer_name,post_name,findings,action_plan"),
      alerts:              () => countTableRows("alerts", "created_at,type,message,user_email"),
      round_sessions:      () => countTableRows("round_sessions", "created_at,round_name,post_name,officer_name,status,checkpoints_total,checkpoints_completed,fraud_score"),
      round_checkpoint_events: () => countTableRows("round_checkpoint_events", "created_at,checkpoint_id,checkpoint_name,event_type,fraud_flag"),
      rounds:              () => countTableRows("rounds", "created_at,name,post,puesto_base,status,frequency"),
      operation_catalog:   () => countTableRows("operation_catalog", "created_at,operation_name,client_name,is_active"),
    }

    const results = await Promise.all(
      relevantTables.map(async (key) => ({ key, data: await tableQueries[key]() }))
    )
    const countResults = await Promise.all(
      relevantTables.map(async (key) => ({ key, total: await countQueries[key]() }))
    )

    const dataMap: DatasetMap = {}
    for (const { key, data } of results) dataMap[key] = data as DatasetRow[]
    const totalsMap: Partial<Record<TableKey, number>> = {}
    for (const { key, total } of countResults) totalsMap[key] = total

    const periodLabel = since === until ? formatDate(since) : `${formatDate(since)} — ${formatDate(until)}`
    const statsContext = buildDatasetStats(dataMap, totalsMap)
    const dataContext = buildDataContext(dataMap, lineLimitPerTable)

    const systemPrompt = [
      "Eres un asistente operativo de seguridad privada para HO Seguridad.",
      `Período consultado: ${periodLabel}`,
      `Modo de análisis: ${deepAnalysis ? "PROFUNDO" : "RÁPIDO"}`,
      operationTerm ? `Filtro solicitado por operación: ${operationTerm}` : "",
      supervisorTerm ? `Filtro solicitado por supervisor: ${supervisorTerm}` : "",
      postTerm ? `Filtro solicitado por puesto: ${postTerm}` : "",
      hourRange ? `Filtro solicitado por hora: ${hourRange.startHour}:00 - ${hourRange.endHour}:59` : "",
      actorRoleLevel === 2 ? "IMPORTANTE: estos datos ya están filtrados por permisos L2 (solo alcance asignado y propio)." : "",
      "Responde en español, de forma clara, concisa y profesional.",
      deepAnalysis
        ? "Haz análisis de patrones, riesgos, causas probables y acciones por prioridad (inmediato, 24h, 7 días)."
        : "Si te piden un resumen, sé breve pero completo.",
      "Cuando te pidan cantidades, usa SIEMPRE el RESUMEN ESTADÍSTICO como fuente principal.",
      statsQuery ? "Devuelve la respuesta con secciones: 1) Qué está pasando, 2) Estadísticas clave, 3) Alertas, 4) Acciones recomendadas." : "",
      "Si no hay datos para la pregunta, dilo claramente.",
      "No inventes información.",
      "",
      statsContext,
      "",
      "DATOS DEL SISTEMA:",
      dataContext,
    ].join("\n")

    const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    // ── Streaming ──────────────────────────────────────────────────────────────
    const aiResponse = await fetch(getOpenAIUrl("/chat/completions"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: getOpenAITimeoutSignal(45000),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? (deepAnalysis ? "gpt-4.1" : "gpt-4o"),
        messages: openaiMessages,
        max_tokens: deepAnalysis ? 900 : 650,
        temperature: deepAnalysis ? 0.2 : 0.3,
        stream: true,
      }),
    })

    if (!aiResponse.ok || !aiResponse.body) {
      const raw = await aiResponse.text()
      if (aiResponse.status === 401 || raw.toLowerCase().includes("invalid_api_key")) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY inválida." }), { status: 502 })
      }
      return new Response(JSON.stringify({ error: `Error IA (${aiResponse.status}).` }), { status: 502 })
    }

    // Pasar el stream de OpenAI directamente al cliente
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = aiResponse.body!.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
            for (const line of lines) {
              try {
                const json = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> }
                const token = json.choices?.[0]?.delta?.content ?? ""
                if (token) controller.enqueue(encoder.encode(token))
              } catch { /* skip malformed chunks */ }
            }
          }
          const activeFilters = [
            since && until ? `Fecha: ${since} a ${until}` : "",
            operationTerm ? `Operación: ${operationTerm}` : "",
            supervisorTerm ? `Supervisor: ${supervisorTerm}` : "",
            postTerm ? `Puesto: ${postTerm}` : "",
            hourRange ? `Hora: ${hourRange.startHour.toString().padStart(2, "0")}:00-${hourRange.endHour.toString().padStart(2, "0")}:59` : "",
          ].filter(Boolean)
          const sourceLines = relevantTables.map((table) => {
            const count = totalsMap[table] ?? 0
            return `- ${getTableLabel(table)}: ${count}`
          })
          const footer = `\n\n---\nFuentes usadas:\n${sourceLines.join("\n")}\n${activeFilters.length ? `Filtros aplicados:\n- ${activeFilters.join("\n- ")}\n` : ""}`
          controller.enqueue(encoder.encode(footer))
        } finally {
          controller.close()
          reader.releaseLock()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    })
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return new Response(JSON.stringify({ error: "La IA tardó demasiado en responder." }), { status: 504 })
    }
    return new Response(JSON.stringify({ error: "Error inesperado en el asistente IA." }), { status: 500 })
  }
}
