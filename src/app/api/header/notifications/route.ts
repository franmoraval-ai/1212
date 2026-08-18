import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"

const INTERNAL_NOTES_SLA_HOURS = Math.max(1, Number(process.env.NEXT_PUBLIC_INTERNAL_NOTES_SLA_HOURS ?? 24))

type HeaderAlertRow = {
  id: string
  type?: string | null
  user_email?: string | null
  created_at?: string | null
}

type HeaderInternalNoteRow = {
  id: string
  post_name?: string | null
  priority?: string | null
  created_at?: string | null
  status?: string | null
  reported_by_user_id?: string | null
  reported_by_email?: string | null
}

type HeaderRoundReportRow = {
  id: string
  round_name?: string | null
  officer_name?: string | null
  created_at?: string | null
  checkpoint_logs?: unknown
}

type HeaderFindingRow = {
  id: string
  category?: string | null
  severity?: string | null
  status?: string | null
  due_at?: string | null
  updated_at?: string | null
  supervision?: {
    operation_name?: string | null
    review_post?: string | null
  } | Array<{
    operation_name?: string | null
    review_post?: string | null
  }> | null
}

type QueryResult<T> = {
  data: T[] | null
  error: { message?: string } | null
}

type CountResult = {
  count: number | null
  error: { message?: string } | null
}

function normalizeAlert(row: HeaderAlertRow) {
  return {
    id: String(row.id ?? ""),
    type: String(row.type ?? ""),
    userEmail: String(row.user_email ?? ""),
    createdAt: row.created_at ?? null,
  }
}

function normalizeInternalNote(row: HeaderInternalNoteRow) {
  return {
    id: String(row.id ?? ""),
    postName: String(row.post_name ?? ""),
    priority: String(row.priority ?? ""),
    createdAt: row.created_at ?? null,
    status: String(row.status ?? ""),
    reportedByUserId: String(row.reported_by_user_id ?? ""),
    reportedByEmail: String(row.reported_by_email ?? ""),
  }
}

function normalizeRoundReport(row: HeaderRoundReportRow) {
  return {
    id: String(row.id ?? ""),
    roundName: String(row.round_name ?? ""),
    officerName: String(row.officer_name ?? ""),
    createdAt: row.created_at ?? null,
    checkpointLogs: row.checkpoint_logs ?? null,
  }
}

function normalizeFinding(row: HeaderFindingRow) {
  const supervision = Array.isArray(row.supervision) ? row.supervision[0] : row.supervision
  return {
    id: String(row.id ?? ""),
    category: String(row.category ?? "Hallazgo"),
    severity: String(row.severity ?? "MEDIA"),
    status: String(row.status ?? "ABIERTO"),
    dueAt: row.due_at ?? null,
    updatedAt: row.updated_at ?? null,
    operationName: String(supervision?.operation_name ?? ""),
    reviewPost: String(supervision?.review_post ?? ""),
  }
}

async function readRows<T>(promise: PromiseLike<QueryResult<T>>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

async function readCount(promise: PromiseLike<CountResult>) {
  const { count, error } = await promise
  return {
    count: Number(count ?? 0),
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

function applyOwnNotesScope(
  query: any,
  requestedScope: string,
  userId: string,
  email: string
) {
  if (requestedScope !== "own") return query

  if (userId && email) {
    return query.or(`reported_by_user_id.eq.${userId},reported_by_email.eq.${email}`)
  }

  if (userId) {
    return query.eq("reported_by_user_id", userId)
  }

  if (email) {
    return query.eq("reported_by_email", email)
  }

  return query
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { admin, actor, error: authError, status: authStatus } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: authError ?? "No autenticado." }, { status: authStatus })
  }

  try {
    const includeFraud = Number(actor.roleLevel ?? 1) >= 2
    const noteScope = Number(actor.roleLevel ?? 1) <= 1 ? "own" : "all"
    const userId = String(actor.userId ?? "").trim()
    const email = String(actor.email ?? "").trim().toLowerCase()
    const overdueBeforeIso = new Date(Date.now() - INTERNAL_NOTES_SLA_HOURS * 60 * 60 * 1000).toISOString()
    const client = createRequestSupabaseClient(bearerToken)

    const alertsPromise = readRows<HeaderAlertRow>(
      client
        .from("alerts")
        .select("id,type,user_email,created_at")
        .order("created_at", { ascending: false })
        .limit(10)
    )

    const recentNotesPromise = readRows<HeaderInternalNoteRow>(
      applyOwnNotesScope(
        client
          .from("internal_notes")
          .select("id,post_name,priority,created_at,status,reported_by_user_id,reported_by_email")
          .neq("status", "resuelta")
          .order("created_at", { ascending: false })
          .limit(8),
        noteScope,
        userId,
        email
      )
    )

    const unresolvedCountPromise = readCount(
      applyOwnNotesScope(
        client
          .from("internal_notes")
          .select("id", { count: "exact", head: true })
          .neq("status", "resuelta"),
        noteScope,
        userId,
        email
      )
    )

    const overdueCountPromise = readCount(
      applyOwnNotesScope(
        client
          .from("internal_notes")
          .select("id", { count: "exact", head: true })
          .neq("status", "resuelta")
          .lt("created_at", overdueBeforeIso),
        noteScope,
        userId,
        email
      )
    )

    const roundReportsPromise = includeFraud
      ? readRows<HeaderRoundReportRow>(
          client
            .from("round_reports")
            .select("id,round_name,officer_name,created_at,checkpoint_logs")
            .order("created_at", { ascending: false })
            .limit(40)
        )
      : Promise.resolve({ rows: [], error: null as string | null })

    const assignedFindingsPromise = readRows<HeaderFindingRow>(
      admin
        .from("supervision_findings")
        .select("id,category,severity,status,due_at,updated_at,supervision:supervision_id(operation_name,review_post)")
        .eq("responsible_user_id", actor.userId)
        .neq("status", "CERRADO")
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(8)
    )

    const assignedFindingsCountPromise = readCount(
      admin
        .from("supervision_findings")
        .select("id", { count: "exact", head: true })
        .eq("responsible_user_id", actor.userId)
        .neq("status", "CERRADO")
    )

    const [alertsResult, recentNotesResult, unresolvedCountResult, overdueCountResult, roundReportsResult, findingsResult, findingsCountResult] = await Promise.all([
      alertsPromise,
      recentNotesPromise,
      unresolvedCountPromise,
      overdueCountPromise,
      roundReportsPromise,
      assignedFindingsPromise,
      assignedFindingsCountPromise,
    ])

    const warnings = [
      alertsResult.error ? `alerts:${alertsResult.error}` : null,
      recentNotesResult.error ? `internal_notes_recent:${recentNotesResult.error}` : null,
      unresolvedCountResult.error ? `internal_notes_count:${unresolvedCountResult.error}` : null,
      overdueCountResult.error ? `internal_notes_overdue:${overdueCountResult.error}` : null,
      roundReportsResult.error ? `round_reports:${roundReportsResult.error}` : null,
      findingsResult.error ? `supervision_findings:${findingsResult.error}` : null,
      findingsCountResult.error ? `supervision_findings_count:${findingsCountResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      alerts: alertsResult.rows.map(normalizeAlert),
      unresolvedInternalNotes: recentNotesResult.rows.map(normalizeInternalNote),
      unresolvedInternalNotesCount: unresolvedCountResult.count,
      overdueInternalNotesCount: overdueCountResult.count,
      roundReports: roundReportsResult.rows.map(normalizeRoundReport),
      assignedFindings: findingsResult.rows.map(normalizeFinding),
      assignedFindingsCount: findingsCountResult.count,
      warnings,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar las notificaciones." },
      { status: 500 }
    )
  }
}