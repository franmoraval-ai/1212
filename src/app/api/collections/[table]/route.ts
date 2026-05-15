import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

const SUPERVISION_COMPAT_COLUMNS = new Set(["officer_phone", "evidence_bundle", "geo_risk"])
const ROUND_REPORT_COMPAT_COLUMNS = new Set(["supervisor_name", "supervisor_id"])
const ADMIN_BYPASS_TABLES = new Set(["supervisions", "round_reports"])

const ALLOWED_TABLES = new Set([
  "alerts",
  "incidents",
  "internal_notes",
  "operation_catalog",
  "round_reports",
  "rounds",
  "supervisions",
  "users",
  "weapons",
])

const ALLOWED_COLUMNS_BY_TABLE: Record<string, string[]> = {
  alerts: ["id", "created_at", "type", "message", "user_id", "user_email", "status", "severity"],
  incidents: [
    "id", "time", "created_at", "status", "priority_level", "title", "incident_type", "description",
    "location", "lugar", "reported_by_user_id", "reported_by_email", "reported_by_name", "evidence_photos", "gps",
  ],
  internal_notes: [
    "id", "created_at", "status", "priority", "category", "detail", "post_name", "reported_by_name",
    "reported_by_user_id", "reported_by_email", "assigned_to", "resolved_at",
  ],
  operation_catalog: ["id", "created_at", "operation_name", "client_name", "is_active"],
  round_reports: [
    "id", "created_at", "round_id", "round_name", "status", "checkpoints_total", "checkpoints_completed", "notes",
    "post_name", "officer_name", "officer_id", "started_at", "finished_at", "duration_minutes", "evidence_photos",
    "gps", "supervisor_name", "supervisor_id", "fraud_flags",
  ],
  rounds: ["id", "created_at", "name", "post", "status", "frequency", "checkpoints", "description", "is_active", "puesto_base"],
  supervisions: [
    "id", "created_at", "operation_name", "officer_name", "type", "id_number", "officer_phone", "weapon_model", "weapon_serial",
    "review_post", "lugar", "gps", "photos", "evidence_bundle", "geo_risk", "checklist", "checklist_reasons",
    "property_details", "observations", "status", "supervisor_id",
  ],
  users: [
    "id", "email", "first_name", "status", "role_level", "assigned", "custom_permissions",
    "is_online", "last_seen", "created_at", "updated_at", "manager_id", "manager_user_id",
  ],
  weapons: ["id", "model", "serial", "status", "assigned_to", "last_check", "location", "created_at", "updated_at", "ammo_count"],
}

function stripSupervisionCompatColumns(selectClause: string) {
  const requested = String(selectClause ?? "").trim()
  if (!requested || requested === "*") return requested

  const parts = requested
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  const sanitized = parts.filter((part) => !SUPERVISION_COMPAT_COLUMNS.has(part.toLowerCase()))
  return sanitized.length > 0 ? sanitized.join(",") : requested
}

function stripRoundReportCompatColumns(selectClause: string) {
  const requested = String(selectClause ?? "").trim()
  if (!requested || requested === "*") return requested

  const parts = requested
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  const sanitized = parts.filter((part) => !ROUND_REPORT_COMPAT_COLUMNS.has(part.toLowerCase()))
  return sanitized.length > 0 ? sanitized.join(",") : requested
}

function parseRequestedColumns(selectClause: string, allowedColumns: Set<string>) {
  const requested = String(selectClause ?? "").trim()
  if (!requested || requested === "*") {
    return Array.from(allowedColumns)
  }

  const columns = requested
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)

  const seen = new Set<string>()
  const validColumns: string[] = []

  for (const column of columns) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(column)) return null
    const normalized = column.toLowerCase()
    if (!allowedColumns.has(normalized)) return null
    if (seen.has(normalized)) continue
    seen.add(normalized)
    validColumns.push(column)
  }

  return validColumns
}

export async function GET(
  request: Request,
  context: { params: Promise<{ table: string }> }
) {
  const { table } = await context.params
  const tableName = String(table ?? "").trim()
  if (!ALLOWED_TABLES.has(tableName)) {
    return NextResponse.json({ error: "Colección no permitida." }, { status: 403 })
  }

  const allowedColumns = new Set((ALLOWED_COLUMNS_BY_TABLE[tableName] ?? []).map((column) => column.toLowerCase()))
  if (allowedColumns.size === 0) {
    return NextResponse.json({ error: "Tabla sin contrato de columnas permitido." }, { status: 500 })
  }

  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, admin, error: actorError, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: actorError ?? "No autenticado." }, { status })
  }

  const requestClient = createRequestSupabaseClient(bearerToken)
  const client = isDirector(actor) && admin && ADMIN_BYPASS_TABLES.has(tableName) ? admin : requestClient

  const url = new URL(request.url)
  const selectParam = String(url.searchParams.get("select") ?? "*").trim() || "*"
  const selectedColumns = parseRequestedColumns(selectParam, allowedColumns)
  if (!selectedColumns || selectedColumns.length === 0) {
    return NextResponse.json({ error: "Select inválido para la colección solicitada." }, { status: 400 })
  }

  const select = selectedColumns.join(",")

  const orderBy = String(url.searchParams.get("orderBy") ?? "").trim()
  if (orderBy && !allowedColumns.has(orderBy.toLowerCase())) {
    return NextResponse.json({ error: "orderBy inválido para la colección solicitada." }, { status: 400 })
  }

  const orderDesc = String(url.searchParams.get("orderDesc") ?? "false").trim().toLowerCase() === "true"
  const limitRaw = Number.parseInt(String(url.searchParams.get("limit") ?? "200"), 10)
  const offsetRaw = Number.parseInt(String(url.searchParams.get("offset") ?? "0"), 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 1000) : 200
  const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0

  let query = client.from(tableName).select(select).range(offset, offset + limit - 1)
  if (orderBy) {
    query = query.order(orderBy, { ascending: !orderDesc })
  }

  let { data, error } = await query

  if (error && tableName === "supervisions") {
    const fallbackSelect = stripSupervisionCompatColumns(select)
    if (fallbackSelect && fallbackSelect !== select) {
      let fallbackQuery = client.from(tableName).select(fallbackSelect).range(offset, offset + limit - 1)
      if (orderBy) {
        fallbackQuery = fallbackQuery.order(orderBy, { ascending: !orderDesc })
      }

      const fallbackResult = await fallbackQuery
      data = fallbackResult.data
      error = fallbackResult.error
    }
  }

  if (error && tableName === "round_reports") {
    const fallbackSelect = stripRoundReportCompatColumns(select)
    if (fallbackSelect && fallbackSelect !== select) {
      let fallbackQuery = client.from(tableName).select(fallbackSelect).range(offset, offset + limit - 1)
      if (orderBy) {
        fallbackQuery = fallbackQuery.order(orderBy, { ascending: !orderDesc })
      }

      const fallbackResult = await fallbackQuery
      data = fallbackResult.data
      error = fallbackResult.error
    }
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rows: data ?? [] })
}