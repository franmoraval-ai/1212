import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { createEmptyManagedTeamScope, loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { canViewSupervisionRecord, loadActorSupervisionScopes } from "@/lib/supervision-visibility"

type OverviewSupervisionRow = {
  id: string
  created_at?: string | null
  event_occurred_at?: string | null
  gps?: unknown
  review_post?: string | null
  officer_name?: string | null
  status?: string | null
  operation_name?: string | null
}

type OverviewIncidentRow = {
  id: string
  time?: string | null
  created_at?: string | null
  status?: string | null
  priority_level?: string | null
  title?: string | null
}

type OverviewRoundReportRow = {
  id: string
  created_at?: string | null
  status?: string | null
  checkpoints_total?: number | null
  checkpoints_completed?: number | null
  post_name?: string | null
  officer_name?: string | null
}

function normalizeSupervision(row: OverviewSupervisionRow) {
  return {
    id: String(row.id ?? ""),
    createdAt: row.created_at ?? null,
    eventOccurredAt: row.event_occurred_at ?? row.created_at ?? null,
    gps: row.gps ?? null,
    reviewPost: String(row.review_post ?? ""),
    officerName: String(row.officer_name ?? ""),
    status: String(row.status ?? ""),
    operationName: String(row.operation_name ?? ""),
  }
}

function normalizeIncident(row: OverviewIncidentRow) {
  return {
    id: String(row.id ?? ""),
    time: row.time ?? null,
    createdAt: row.created_at ?? null,
    status: String(row.status ?? ""),
    priorityLevel: String(row.priority_level ?? ""),
    title: String(row.title ?? ""),
  }
}

function normalizeRoundReport(row: OverviewRoundReportRow) {
  return {
    id: String(row.id ?? ""),
    createdAt: row.created_at ?? null,
    status: String(row.status ?? ""),
    checkpointsTotal: Number(row.checkpoints_total ?? 0),
    checkpointsCompleted: Number(row.checkpoints_completed ?? 0),
    postName: String(row.post_name ?? ""),
    officerName: String(row.officer_name ?? ""),
  }
}

async function readOverviewSlice<T>(promise: PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: (Array.isArray(data) ? data : []) as T[],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
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
    const url = new URL(request.url)
    const fromIso = String(url.searchParams.get("from") ?? "").trim()
    const toIso = String(url.searchParams.get("to") ?? "").trim()
    const client = createRequestSupabaseClient(bearerToken)
    const [actorScopes, managedTeamResult] = await Promise.all([
      loadActorSupervisionScopes(admin, actor),
      loadManagedTeamScope(admin, actor),
    ])
    if (managedTeamResult.error) {
      return NextResponse.json({ error: managedTeamResult.error }, { status: 500 })
    }
    const managedTeamScope = managedTeamResult.scope ?? createEmptyManagedTeamScope()

    const runSupervisionsQuery = (includeEventDate: boolean) => {
      let query = admin
        .from("supervisions")
        .select(includeEventDate
          ? "id,created_at,event_occurred_at,gps,review_post,officer_name,status,operation_name,supervisor_id"
          : "id,created_at,gps,review_post,officer_name,status,operation_name,supervisor_id")
        .order("created_at", { ascending: false })

      if (fromIso && toIso) {
        query = includeEventDate
          ? query.or(`and(event_occurred_at.gte.${fromIso},event_occurred_at.lt.${toIso}),and(event_occurred_at.is.null,created_at.gte.${fromIso},created_at.lt.${toIso})`)
          : query.gte("created_at", fromIso).lt("created_at", toIso)
      } else {
        if (fromIso) query = query.gte(includeEventDate ? "event_occurred_at" : "created_at", fromIso)
        if (toIso) query = query.lt(includeEventDate ? "event_occurred_at" : "created_at", toIso)
      }

      return query
    }

    let supervisionsResult = await readOverviewSlice<OverviewSupervisionRow>(runSupervisionsQuery(true))
    if (supervisionsResult.error?.toLowerCase().includes("event_occurred_at")) {
      supervisionsResult = await readOverviewSlice<OverviewSupervisionRow>(runSupervisionsQuery(false))
    }
    if (supervisionsResult.error) {
      return NextResponse.json(
        { error: `No se pudo cargar el conteo de supervisiones: ${supervisionsResult.error}` },
        { status: 500 }
      )
    }

    const visibleSupervisions = supervisionsResult.rows.filter((row) => canViewSupervisionRecord(
      actor,
      managedTeamScope,
      row as unknown as Record<string, unknown>,
      actorScopes
    ))

    const [incidentsResult, roundReportsResult] = await Promise.all([
      readOverviewSlice<OverviewIncidentRow>(
        (() => {
          let query = client
            .from("incidents")
            .select("id,time,created_at,status,priority_level,title")
            .order("created_at", { ascending: false })

          if (fromIso) query = query.gte("created_at", fromIso)
          if (toIso) query = query.lt("created_at", toIso)

          return query
        })()
      ),
      readOverviewSlice<OverviewRoundReportRow>(
        (() => {
          let query = client
            .from("round_reports")
            .select("id,created_at,status,checkpoints_total,checkpoints_completed,post_name,officer_name")
            .order("created_at", { ascending: false })

          if (fromIso) query = query.gte("created_at", fromIso)
          if (toIso) query = query.lt("created_at", toIso)

          return query
        })()
      ),
    ])

    const warnings = [
      supervisionsResult.error ? `supervisions:${supervisionsResult.error}` : null,
      incidentsResult.error ? `incidents:${incidentsResult.error}` : null,
      roundReportsResult.error ? `round_reports:${roundReportsResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      supervisions: visibleSupervisions.map(normalizeSupervision),
      incidents: incidentsResult.rows.map(normalizeIncident),
      roundReports: roundReportsResult.rows.map(normalizeRoundReport),
      warnings,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo cargar overview." },
      { status: 500 }
    )
  }
}