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

export async function GET(
  request: Request,
  context: { params: Promise<{ table: string }> }
) {
  const { table } = await context.params
  const tableName = String(table ?? "").trim()
  if (!ALLOWED_TABLES.has(tableName)) {
    return NextResponse.json({ error: "Colección no permitida." }, { status: 403 })
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
  const select = String(url.searchParams.get("select") ?? "*").trim() || "*"
  const orderBy = String(url.searchParams.get("orderBy") ?? "").trim()
  const orderDesc = String(url.searchParams.get("orderDesc") ?? "false").trim().toLowerCase() === "true"

  let query = client.from(tableName).select(select)
  if (orderBy) {
    query = query.order(orderBy, { ascending: !orderDesc })
  }

  let { data, error } = await query

  if (error && tableName === "supervisions") {
    const fallbackSelect = stripSupervisionCompatColumns(select)
    if (fallbackSelect && fallbackSelect !== select) {
      let fallbackQuery = client.from(tableName).select(fallbackSelect)
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
      let fallbackQuery = client.from(tableName).select(fallbackSelect)
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