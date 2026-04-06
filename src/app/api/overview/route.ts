import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"

type OverviewSupervisionRow = {
  id: string
  created_at?: string | null
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

async function readOverviewSlice<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const [supervisionsResult, incidentsResult, roundReportsResult] = await Promise.all([
      readOverviewSlice<OverviewSupervisionRow>(
        client
          .from("supervisions")
          .select("id,created_at,gps,review_post,officer_name,status,operation_name")
          .order("created_at", { ascending: false })
      ),
      readOverviewSlice<OverviewIncidentRow>(
        client
          .from("incidents")
          .select("id,time,created_at,status,priority_level,title")
          .order("time", { ascending: false })
      ),
      readOverviewSlice<OverviewRoundReportRow>(
        client
          .from("round_reports")
          .select("id,created_at,status,checkpoints_total,checkpoints_completed,post_name,officer_name")
          .order("created_at", { ascending: false })
      ),
    ])

    const warnings = [
      supervisionsResult.error ? `supervisions:${supervisionsResult.error}` : null,
      incidentsResult.error ? `incidents:${incidentsResult.error}` : null,
      roundReportsResult.error ? `round_reports:${roundReportsResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      supervisions: supervisionsResult.rows.map(normalizeSupervision),
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