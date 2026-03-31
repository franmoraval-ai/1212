import type { SupabaseClient } from "@supabase/supabase-js"

export type DataOpsEntity = "supervisions" | "round_reports" | "incidents" | "internal_notes" | "visitors" | "weapons"
export type DataOpsSource = "live" | "archive"
export type DataExportFormat = "csv" | "json"

export type DataOpsFilters = {
  dateFrom?: string | null
  dateTo?: string | null
  search?: string | null
  status?: string | null
  operation?: string | null
  post?: string | null
  officer?: string | null
  supervisor?: string | null
  limit?: number | null
}

type DataOpsColumn = {
  key: string
  header: string
}

type DataOpsEntityConfig = {
  label: string
  liveTable: string
  archiveTable: string
  dateField: string
  selectFields: string[]
  searchFields: string[]
  columns: DataOpsColumn[]
  summary: (row: Record<string, unknown>) => string
}

const MAX_EXPORT_ROWS = 10000
const DEFAULT_EXPORT_ROWS = 2000
const DEFAULT_HISTORY_ROWS = 100

const entityConfigs: Record<DataOpsEntity, DataOpsEntityConfig> = {
  supervisions: {
    label: "Supervisiones",
    liveTable: "supervisions",
    archiveTable: "archived_supervisions",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "operation_name",
      "review_post",
      "officer_name",
      "supervisor_id",
      "status",
      "type",
      "observations",
    ],
    searchFields: ["operation_name", "review_post", "officer_name", "status", "type", "observations"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "FECHA" },
      { key: "operation_name", header: "OPERACION" },
      { key: "review_post", header: "PUESTO" },
      { key: "officer_name", header: "OFICIAL" },
      { key: "supervisor_id", header: "SUPERVISOR" },
      { key: "status", header: "ESTADO" },
      { key: "type", header: "TIPO" },
      { key: "observations", header: "OBSERVACIONES" },
    ],
    summary: (row) => {
      const operation = String(row.operation_name ?? "SIN OPERACION").trim() || "SIN OPERACION"
      const post = String(row.review_post ?? "SIN PUESTO").trim() || "SIN PUESTO"
      const officer = String(row.officer_name ?? "SIN OFICIAL").trim() || "SIN OFICIAL"
      return `${operation} | ${post} | ${officer}`
    },
  },
  round_reports: {
    label: "Rondas",
    liveTable: "round_reports",
    archiveTable: "archived_round_reports",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "round_name",
      "post_name",
      "officer_id",
      "officer_name",
      "status",
      "checkpoints_total",
      "checkpoints_completed",
      "notes",
    ],
    searchFields: ["round_name", "post_name", "officer_name", "status", "notes"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "FECHA" },
      { key: "round_name", header: "RONDA" },
      { key: "post_name", header: "PUESTO" },
      { key: "officer_id", header: "OFICIAL_ID" },
      { key: "officer_name", header: "OFICIAL" },
      { key: "status", header: "ESTADO" },
      { key: "checkpoints_total", header: "CHECKPOINTS_TOTAL" },
      { key: "checkpoints_completed", header: "CHECKPOINTS_COMPLETADOS" },
      { key: "notes", header: "NOTAS" },
    ],
    summary: (row) => {
      const round = String(row.round_name ?? "SIN RONDA").trim() || "SIN RONDA"
      const post = String(row.post_name ?? "SIN PUESTO").trim() || "SIN PUESTO"
      const officer = String(row.officer_name ?? "SIN OFICIAL").trim() || "SIN OFICIAL"
      return `${round} | ${post} | ${officer}`
    },
  },
  incidents: {
    label: "Incidentes",
    liveTable: "incidents",
    archiveTable: "archived_incidents",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "time",
      "title",
      "incident_type",
      "location",
      "priority_level",
      "status",
      "reported_by",
      "description",
    ],
    searchFields: ["title", "incident_type", "location", "priority_level", "status", "reported_by", "description"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "FECHA_CREACION" },
      { key: "time", header: "FECHA_EVENTO" },
      { key: "title", header: "TITULO" },
      { key: "incident_type", header: "TIPO" },
      { key: "location", header: "UBICACION" },
      { key: "priority_level", header: "PRIORIDAD" },
      { key: "status", header: "ESTADO" },
      { key: "reported_by", header: "REPORTADO_POR" },
      { key: "description", header: "DESCRIPCION" },
    ],
    summary: (row) => {
      const title = String(row.title ?? "SIN TITULO").trim() || "SIN TITULO"
      const location = String(row.location ?? "SIN UBICACION").trim() || "SIN UBICACION"
      const status = String(row.status ?? "SIN ESTADO").trim() || "SIN ESTADO"
      return `${title} | ${location} | ${status}`
    },
  },
  internal_notes: {
    label: "Novedades Internas",
    liveTable: "internal_notes",
    archiveTable: "archived_internal_notes",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "post_name",
      "category",
      "priority",
      "detail",
      "status",
      "reported_by_name",
      "reported_by_email",
      "assigned_to",
      "resolution_note",
    ],
    searchFields: ["post_name", "category", "priority", "detail", "status", "reported_by_name", "reported_by_email", "assigned_to", "resolution_note"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "FECHA" },
      { key: "post_name", header: "PUESTO" },
      { key: "category", header: "CATEGORIA" },
      { key: "priority", header: "PRIORIDAD" },
      { key: "detail", header: "DETALLE" },
      { key: "status", header: "ESTADO" },
      { key: "reported_by_name", header: "REPORTADO_POR" },
      { key: "assigned_to", header: "ASIGNADO_A" },
      { key: "resolution_note", header: "RESOLUCION" },
    ],
    summary: (row) => {
      const post = String(row.post_name ?? "SIN PUESTO").trim() || "SIN PUESTO"
      const priority = String(row.priority ?? "SIN PRIORIDAD").trim() || "SIN PRIORIDAD"
      const detail = String(row.detail ?? "SIN DETALLE").trim() || "SIN DETALLE"
      return `${post} | ${priority} | ${detail.slice(0, 64)}`
    },
  },
  visitors: {
    label: "Visitantes",
    liveTable: "visitors",
    archiveTable: "archived_visitors",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "entry_time",
      "exit_time",
      "name",
      "document_id",
      "visited_person",
      "destination",
      "post",
      "status",
    ],
    searchFields: ["name", "document_id", "visited_person", "destination", "post", "status"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "CREADO_EN" },
      { key: "entry_time", header: "ENTRADA" },
      { key: "exit_time", header: "SALIDA" },
      { key: "name", header: "NOMBRE" },
      { key: "document_id", header: "DOCUMENTO" },
      { key: "visited_person", header: "VISITADO" },
      { key: "destination", header: "DESTINO" },
      { key: "post", header: "PUESTO" },
      { key: "status", header: "ESTADO" },
    ],
    summary: (row) => {
      const name = String(row.name ?? "SIN NOMBRE").trim() || "SIN NOMBRE"
      const destination = String(row.destination ?? row.post ?? "SIN DESTINO").trim() || "SIN DESTINO"
      const status = String(row.status ?? "SIN ESTADO").trim() || "SIN ESTADO"
      return `${name} | ${destination} | ${status}`
    },
  },
  weapons: {
    label: "Armamento",
    liveTable: "weapons",
    archiveTable: "archived_weapons",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "serial",
      "model",
      "type",
      "status",
      "assigned_to",
      "ammo_count",
      "location",
      "last_check",
    ],
    searchFields: ["serial", "model", "type", "status", "assigned_to"],
    columns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "CREADO_EN" },
      { key: "serial", header: "SERIE" },
      { key: "model", header: "MODELO" },
      { key: "type", header: "TIPO" },
      { key: "status", header: "ESTADO" },
      { key: "assigned_to", header: "ASIGNADO_A" },
      { key: "ammo_count", header: "MUNICIONES" },
      { key: "last_check", header: "ULTIMA_REVISION" },
    ],
    summary: (row) => {
      const serial = String(row.serial ?? "SIN SERIE").trim() || "SIN SERIE"
      const model = String(row.model ?? "SIN MODELO").trim() || "SIN MODELO"
      const status = String(row.status ?? "SIN ESTADO").trim() || "SIN ESTADO"
      return `${serial} | ${model} | ${status}`
    },
  },
}

export function getDataOpsEntityConfig(entity: DataOpsEntity) {
  return entityConfigs[entity]
}

export function isDataOpsEntity(value: string): value is DataOpsEntity {
  return value in entityConfigs
}

export function normalizeDataOpsFilters(raw: unknown): DataOpsFilters {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}
  const normalizeText = (input: unknown) => {
    const text = String(input ?? "").trim()
    return text ? text : null
  }

  const parsedLimit = Number(value.limit ?? DEFAULT_EXPORT_ROWS)

  return {
    dateFrom: normalizeText(value.dateFrom),
    dateTo: normalizeText(value.dateTo),
    search: normalizeText(value.search),
    status: normalizeText(value.status),
    operation: normalizeText(value.operation),
    post: normalizeText(value.post),
    officer: normalizeText(value.officer),
    supervisor: normalizeText(value.supervisor),
    limit: Number.isFinite(parsedLimit)
      ? Math.min(Math.max(Math.trunc(parsedLimit), 1), MAX_EXPORT_ROWS)
      : DEFAULT_EXPORT_ROWS,
  }
}

function escapeLikeTerm(value: string) {
  return value.replace(/[%_,]/g, " ").trim()
}

function normalizeFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function formatScalar(value: unknown): string | number {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value as string | number
  return JSON.stringify(value)
}

function csvEscape(value: unknown) {
  const text = String(formatScalar(value)).replace(/\r?\n|\r/g, " ")
  if (/[",;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function appendStandardFilters(
  query: any,
  config: DataOpsEntityConfig,
  filters: DataOpsFilters
) {
  let nextQuery = query

  if (filters.dateFrom) {
    nextQuery = nextQuery.gte(config.dateField, `${filters.dateFrom}T00:00:00.000Z`)
  }

  if (filters.dateTo) {
    nextQuery = nextQuery.lte(config.dateField, `${filters.dateTo}T23:59:59.999Z`)
  }

  if (filters.status) {
    nextQuery = nextQuery.ilike("status", filters.status)
  }

  if (filters.operation && config.selectFields.includes("operation_name")) {
    nextQuery = nextQuery.ilike("operation_name", `%${escapeLikeTerm(filters.operation)}%`)
  }

  if (filters.post) {
    if (config.selectFields.includes("review_post")) {
      nextQuery = nextQuery.ilike("review_post", `%${escapeLikeTerm(filters.post)}%`)
    } else if (config.selectFields.includes("post_name")) {
      nextQuery = nextQuery.ilike("post_name", `%${escapeLikeTerm(filters.post)}%`)
    }
  }

  if (filters.officer && config.selectFields.includes("officer_name")) {
    nextQuery = nextQuery.ilike("officer_name", `%${escapeLikeTerm(filters.officer)}%`)
  }

  if (filters.supervisor && config.selectFields.includes("supervisor_id")) {
    nextQuery = nextQuery.ilike("supervisor_id", `%${escapeLikeTerm(filters.supervisor)}%`)
  }

  if (filters.search) {
    const term = escapeLikeTerm(filters.search)
    if (term) {
      nextQuery = nextQuery.or(config.searchFields.map((field) => `${field}.ilike.%${term}%`).join(","))
    }
  }

  return nextQuery
}

export async function fetchDataOpsRows(
  admin: SupabaseClient,
  entity: DataOpsEntity,
  source: DataOpsSource,
  filters: DataOpsFilters,
  limitOverride?: number
) {
  const config = getDataOpsEntityConfig(entity)
  const tableName = source === "archive" ? config.archiveTable : config.liveTable
  const selectFields = source === "archive"
    ? ["original_id", "archived_at", "archived_by", "archive_run_id", ...config.selectFields]
    : config.selectFields

  let query = admin.from(tableName).select(selectFields.join(",")).order(config.dateField, { ascending: false })
  query = appendStandardFilters(query, config, filters)
  const limit = Math.min(Math.max(Number(limitOverride ?? filters.limit ?? DEFAULT_EXPORT_ROWS), 1), MAX_EXPORT_ROWS)
  query = query.limit(limit)

  const { data, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  return (data ?? []) as unknown as Record<string, unknown>[]
}

export async function fetchArchivedHistoryRows(
  admin: SupabaseClient,
  entity: DataOpsEntity,
  filters: DataOpsFilters,
  limitOverride?: number
) {
  const rows = await fetchDataOpsRows(admin, entity, "archive", filters, limitOverride ?? DEFAULT_HISTORY_ROWS)
  const config = getDataOpsEntityConfig(entity)

  return rows.map((row) => ({
    id: String(row.original_id ?? row.id ?? ""),
    archivedAt: String(row.archived_at ?? ""),
    createdAt: String(row.created_at ?? ""),
    summary: config.summary(row),
    status: String(row.status ?? ""),
    raw: row,
  }))
}

export function buildExportPayload(entity: DataOpsEntity, source: DataOpsSource, format: DataExportFormat, rows: Record<string, unknown>[]) {
  const config = getDataOpsEntityConfig(entity)
  const columns = source === "archive"
    ? [
        { key: "original_id", header: "ORIGINAL_ID" },
        { key: "archived_at", header: "ARCHIVADO_EN" },
        { key: "archived_by", header: "ARCHIVADO_POR" },
        ...config.columns,
      ]
    : config.columns

  const timestamp = new Date().toISOString().slice(0, 10)
  const filenameBase = `ho-${normalizeFilenamePart(config.label)}-${source}-${timestamp}`
  const mimeType = format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8"
  const extension = format === "json" ? "json" : "csv"
  const filename = `${filenameBase}.${extension}`

  if (format === "json") {
    return {
      mimeType,
      filename,
      content: JSON.stringify(rows, null, 2),
      rowCount: rows.length,
    }
  }

  const headerLine = columns.map((column) => csvEscape(column.header)).join(",")
  const lines = rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(","))

  return {
    mimeType,
    filename,
    content: [headerLine, ...lines].join("\n"),
    rowCount: rows.length,
  }
}

export function getArchiveTableName(entity: DataOpsEntity) {
  return getDataOpsEntityConfig(entity).archiveTable
}

export function getLiveTableName(entity: DataOpsEntity) {
  return getDataOpsEntityConfig(entity).liveTable
}

export function getExportLimitHelp() {
  return {
    max: MAX_EXPORT_ROWS,
    recommended: DEFAULT_EXPORT_ROWS,
  }
}
