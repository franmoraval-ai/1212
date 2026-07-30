import type { SupabaseClient } from "@supabase/supabase-js"
import * as ExcelJS from "exceljs"
import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"

export type DataOpsEntity = "supervisions" | "round_reports" | "incidents" | "internal_notes" | "visitors" | "weapons"
export type DataOpsSource = "live" | "archive"
export type DataExportFormat = "csv" | "json" | "xlsx" | "pdf"

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
  analyticalColumns?: DataOpsColumn[]
  summary: (row: Record<string, unknown>) => string
}

export type DataExportPayload = {
  mimeType: string
  filename: string
  content: string | ArrayBuffer
  rowCount: number
}

const MAX_EXPORT_ROWS = 10000
const DEFAULT_EXPORT_ROWS = MAX_EXPORT_ROWS
const DEFAULT_HISTORY_ROWS = 100
const DATA_OPS_QUERY_PAGE_SIZE = 1000
const SUPERVISION_COMPAT_SELECT_FIELDS = new Set([
  "officer_phone",
  "evidence_bundle",
  "geo_risk",
  "operation_catalog_id",
])

const entityConfigs: Record<DataOpsEntity, DataOpsEntityConfig> = {
  supervisions: {
    label: "Supervisiones",
    liveTable: "supervisions",
    archiveTable: "archived_supervisions",
    dateField: "created_at",
    selectFields: [
      "id",
      "created_at",
      "operation_catalog_id",
      "operation_name",
      "review_post",
      "officer_name",
      "id_number",
      "officer_phone",
      "weapon_model",
      "weapon_serial",
      "lugar",
      "supervisor_id",
      "status",
      "type",
      "observations",
      "gps",
      "checklist",
      "checklist_reasons",
      "property_details",
      "photos",
      "evidence_bundle",
      "geo_risk",
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
    analyticalColumns: [
      { key: "id", header: "ID" },
      { key: "created_at", header: "FECHA" },
      { key: "operation_catalog_id", header: "OPERACION_CATALOGO_ID" },
      { key: "operation_name", header: "OPERACION" },
      { key: "review_post", header: "PUESTO" },
      { key: "officer_name", header: "OFICIAL" },
      { key: "id_number", header: "CEDULA" },
      { key: "officer_phone", header: "TELEFONO" },
      { key: "weapon_model", header: "ARMA_MODELO" },
      { key: "weapon_serial", header: "ARMA_SERIE" },
      { key: "lugar", header: "LUGAR" },
      { key: "supervisor_id", header: "SUPERVISOR" },
      { key: "status", header: "ESTADO" },
      { key: "type", header: "TIPO" },
      { key: "observations", header: "OBSERVACIONES" },
      { key: "gps_lat", header: "GPS_LAT" },
      { key: "gps_lng", header: "GPS_LNG" },
      { key: "gps_accuracy_m", header: "GPS_PRECISION_M" },
      { key: "gps_json", header: "GPS_JSON" },
      { key: "checklist_uniform", header: "CHECKLIST_UNIFORME" },
      { key: "checklist_equipment", header: "CHECKLIST_EQUIPO" },
      { key: "checklist_punctuality", header: "CHECKLIST_PUNTUALIDAD" },
      { key: "checklist_service", header: "CHECKLIST_SERVICIO" },
      { key: "checklist_json", header: "CHECKLIST_JSON" },
      { key: "checklist_reasons_json", header: "JUSTIFICACIONES_JSON" },
      { key: "property_luz", header: "PROPIEDAD_LUZ" },
      { key: "property_perimetro", header: "PROPIEDAD_PERIMETRO" },
      { key: "property_sacate", header: "PROPIEDAD_SACATE" },
      { key: "property_danos", header: "PROPIEDAD_DANOS" },
      { key: "property_details_json", header: "PROPIEDAD_JSON" },
      { key: "photo_count", header: "EVIDENCIAS_FOTOS" },
      { key: "photos_metadata_json", header: "FOTOS_METADATA_JSON" },
      { key: "evidence_captured_at", header: "EVIDENCIA_CAPTURADA_EN" },
      { key: "evidence_user_uid", header: "EVIDENCIA_USUARIO_UID" },
      { key: "evidence_user_email", header: "EVIDENCIA_USUARIO_EMAIL" },
      { key: "evidence_bundle_json", header: "EVIDENCIA_JSON" },
      { key: "geo_risk_level", header: "RIESGO_GPS_NIVEL" },
      { key: "geo_risk_flags_json", header: "RIESGO_GPS_BANDERAS_JSON" },
      { key: "geo_risk_speed_kmh", header: "RIESGO_GPS_VELOCIDAD_KMH" },
      { key: "geo_risk_json", header: "RIESGO_GPS_JSON" },
      { key: "registro_analitico_json", header: "REGISTRO_ANALITICO_JSON" },
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

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function asJsonText(value: unknown) {
  return value == null ? "" : JSON.stringify(value)
}

function getPhotoMetadata(value: unknown) {
  if (!Array.isArray(value)) return []

  return value.map((photo, index) => {
    if (photo && typeof photo === "object") {
      const metadata = asRecord(photo)
      return {
        index: metadata.index ?? index,
        capturedAt: metadata.capturedAt ?? null,
        mimeType: metadata.mimeType ?? null,
        sizeKb: metadata.sizeKb ?? null,
      }
    }

    const dataUrl = String(photo ?? "")
    const [prefix, payload] = dataUrl.split(",")
    return {
      index,
      mimeType: prefix.match(/^data:(.*?);base64$/)?.[1] ?? null,
      sizeKb: payload ? Math.round((payload.length * 3) / 4096) : null,
    }
  })
}

function prepareSupervisionExportRow(row: Record<string, unknown>): Record<string, unknown> {
  const { photos: rawPhotos, evidence_bundle: rawEvidenceBundle, ...analyticalRow } = row
  const gps = asRecord(row.gps)
  const checklist = asRecord(row.checklist)
  const checklistReasons = asRecord(row.checklist_reasons)
  const propertyDetails = asRecord(row.property_details)
  const evidenceBundle = asRecord(rawEvidenceBundle)
  const evidenceUser = asRecord(evidenceBundle.user)
  const geoRisk = asRecord(row.geo_risk)
  const evidencePhotos = getPhotoMetadata(evidenceBundle.photos)
  const photosMetadata = evidencePhotos.length > 0 ? evidencePhotos : getPhotoMetadata(rawPhotos)
  const { photos: _, ...evidenceWithoutPhotos } = evidenceBundle
  const safeEvidenceBundle = { ...evidenceWithoutPhotos, photos: photosMetadata }

  const prepared: Record<string, unknown> = {
    ...analyticalRow,
    evidence_bundle: safeEvidenceBundle,
    gps_lat: gps.lat ?? "",
    gps_lng: gps.lng ?? "",
    gps_accuracy_m: gps.accuracy ?? "",
    gps_json: asJsonText(row.gps),
    checklist_uniform: checklist.uniform ?? "",
    checklist_equipment: checklist.equipment ?? "",
    checklist_punctuality: checklist.punctuality ?? "",
    checklist_service: checklist.service ?? "",
    checklist_json: asJsonText(row.checklist),
    checklist_reasons_json: asJsonText(row.checklist_reasons),
    property_luz: propertyDetails.luz ?? "",
    property_perimetro: propertyDetails.perimetro ?? "",
    property_sacate: propertyDetails.sacate ?? "",
    property_danos: propertyDetails.danosPropiedad ?? "",
    property_details_json: asJsonText(row.property_details),
    photo_count: photosMetadata.length,
    photos_metadata_json: asJsonText(photosMetadata),
    evidence_captured_at: evidenceBundle.capturedAt ?? "",
    evidence_user_uid: evidenceUser.uid ?? "",
    evidence_user_email: evidenceUser.email ?? "",
    evidence_bundle_json: asJsonText(safeEvidenceBundle),
    geo_risk_level: geoRisk.riskLevel ?? "",
    geo_risk_flags_json: asJsonText(geoRisk.flags ?? []),
    geo_risk_speed_kmh: geoRisk.estimatedSpeedKmh ?? "",
    geo_risk_json: asJsonText(row.geo_risk),
  }

  return {
    ...prepared,
    registro_analitico_json: asJsonText(prepared),
  }
}

function prepareDataOpsExportRows(entity: DataOpsEntity, rows: Record<string, unknown>[]) {
  return entity === "supervisions" ? rows.map(prepareSupervisionExportRow) : rows
}

function csvEscape(value: unknown) {
  const text = String(formatScalar(value)).replace(/\r?\n|\r/g, " ")
  if (/[",;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function convertExcelValue(value: unknown) {
  const formatted = formatScalar(value)
  if (typeof formatted === "number") return formatted
  return String(formatted)
}

function convertPdfValue(value: unknown) {
  return String(formatScalar(value)).replace(/\r?\n|\r/g, " ")
}

async function buildXlsxBuffer(columns: DataOpsColumn[], rows: Record<string, unknown>[]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet("Export")

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.min(Math.max(column.header.length + 4, 12), 42),
  }))

  rows.forEach((row) => {
    const normalized: Record<string, string | number> = {}
    columns.forEach((column) => {
      normalized[column.key] = convertExcelValue(row[column.key])
    })
    sheet.addRow(normalized)
  })

  const headerRow = sheet.getRow(1)
  headerRow.font = { bold: true }
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true }

  const buffer = await workbook.xlsx.writeBuffer()
  return new Uint8Array(buffer as ArrayBufferLike).buffer as ArrayBuffer
}

function buildPdfBuffer(title: string, columns: DataOpsColumn[], rows: Record<string, unknown>[]) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true })
  const generatedAt = new Date().toLocaleString()

  doc.setFontSize(13)
  doc.text(`HO SEGURIDAD - ${title.toUpperCase()}`, 14, 12)
  doc.setFontSize(9)
  doc.text(`Generado: ${generatedAt}`, doc.internal.pageSize.getWidth() - 58, 12)

  autoTable(doc, {
    head: [columns.map((column) => column.header)],
    body: rows.map((row) => columns.map((column) => convertPdfValue(row[column.key]))),
    startY: 18,
    theme: "grid",
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    styles: { fontSize: 7.5, cellPadding: 1.8, overflow: "linebreak", valign: "top" },
    margin: { left: 12, right: 12, top: 18, bottom: 12 },
    didDrawPage: (hookData) => {
      const pageHeight = doc.internal.pageSize.getHeight()
      const pageNumber = doc.getNumberOfPages()
      doc.setFontSize(8)
      doc.text(`Pagina ${pageNumber}`, hookData.settings.margin.left, pageHeight - 5)
    },
  })

  return doc.output("arraybuffer")
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

function getCompatibleSupervisionSelectFields(selectFields: string[]) {
  return selectFields.filter((field) => !SUPERVISION_COMPAT_SELECT_FIELDS.has(field))
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
  const limit = Math.min(Math.max(Number(limitOverride ?? filters.limit ?? DEFAULT_EXPORT_ROWS), 1), MAX_EXPORT_ROWS)
  const rows: Record<string, unknown>[] = []
  let activeSelectFields = selectFields

  for (let offset = 0; offset < limit; offset += DATA_OPS_QUERY_PAGE_SIZE) {
    const pageSize = Math.min(DATA_OPS_QUERY_PAGE_SIZE, limit - offset)
    let query = admin
      .from(tableName)
      .select(activeSelectFields.join(","))
      .order(config.dateField, { ascending: false })
      .order("id", { ascending: false })
    query = appendStandardFilters(query, config, filters)

    let { data, error } = await query.range(offset, offset + pageSize - 1)
    if (error && entity === "supervisions") {
      const compatibleSelectFields = getCompatibleSupervisionSelectFields(activeSelectFields)
      if (compatibleSelectFields.length !== activeSelectFields.length) {
        activeSelectFields = compatibleSelectFields
        let fallbackQuery = admin
          .from(tableName)
          .select(activeSelectFields.join(","))
          .order(config.dateField, { ascending: false })
          .order("id", { ascending: false })
        fallbackQuery = appendStandardFilters(fallbackQuery, config, filters)
        const fallback = await fallbackQuery.range(offset, offset + pageSize - 1)
        data = fallback.data
        error = fallback.error
      }
    }

    if (error) {
      throw new Error(error.message)
    }

    const pageRows = (data ?? []) as unknown as Record<string, unknown>[]
    rows.push(...pageRows)
    if (pageRows.length < pageSize) break
  }

  return rows
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

export async function buildExportPayload(
  entity: DataOpsEntity,
  source: DataOpsSource,
  format: DataExportFormat,
  rows: Record<string, unknown>[]
): Promise<DataExportPayload> {
  const config = getDataOpsEntityConfig(entity)
  const preparedRows = prepareDataOpsExportRows(entity, rows)
  const baseColumns = format === "csv" ? (config.analyticalColumns ?? config.columns) : config.columns
  const columns = source === "archive"
    ? [
        { key: "original_id", header: "ORIGINAL_ID" },
        { key: "archived_at", header: "ARCHIVADO_EN" },
        { key: "archived_by", header: "ARCHIVADO_POR" },
        ...baseColumns,
      ]
    : baseColumns

  const timestamp = new Date().toISOString().slice(0, 10)
  const filenameBase = `ho-${normalizeFilenamePart(config.label)}-${source}-${timestamp}`
  if (format === "xlsx") {
    const content = await buildXlsxBuffer(columns, preparedRows)
    return {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${filenameBase}.xlsx`,
      content,
      rowCount: preparedRows.length,
    }
  }

  if (format === "pdf") {
    const content = buildPdfBuffer(config.label, columns, preparedRows)
    return {
      mimeType: "application/pdf",
      filename: `${filenameBase}.pdf`,
      content,
      rowCount: preparedRows.length,
    }
  }

  const mimeType = format === "json" ? "application/json; charset=utf-8" : "text/csv; charset=utf-8"
  const extension = format === "json" ? "json" : "csv"
  const filename = `${filenameBase}.${extension}`

  if (format === "json") {
    return {
      mimeType,
      filename,
      content: JSON.stringify(preparedRows, null, 2),
      rowCount: preparedRows.length,
    }
  }

  const headerLine = columns.map((column) => csvEscape(column.header)).join(",")
  const lines = preparedRows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(","))

  return {
    mimeType,
    filename,
    content: [headerLine, ...lines].join("\n"),
    rowCount: preparedRows.length,
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
