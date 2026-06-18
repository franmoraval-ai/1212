import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { ROUND_REPORT_GROUPED_SUMMARY_SELECT, SUPERVISION_LIST_SUMMARY_SELECT, SUPERVISION_LIST_SUMMARY_SELECT_STABLE } from "@/lib/supervision-selects"

const DEFAULT_SUPERVISIONS_LIMIT = 400
const DEFAULT_USERS_LIMIT = 500
const DEFAULT_ROUND_REPORTS_LIMIT = 400
const MAX_CONTEXT_LIMIT = 1000

function resolveContextLimit(value: string | null, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(parsed, MAX_CONTEXT_LIMIT)
}

export async function GET(request: Request) {
  const requestStartedAt = Date.now()
  const timings: Record<string, number> = {}

  const measure = <T,>(label: string, startedAt: number, value: T): T => {
    timings[label] = Date.now() - startedAt
    return value
  }

  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const url = new URL(request.url)
    const supervisionsLimit = resolveContextLimit(url.searchParams.get("supervisionsLimit"), DEFAULT_SUPERVISIONS_LIMIT)
    const usersLimit = resolveContextLimit(url.searchParams.get("usersLimit"), DEFAULT_USERS_LIMIT)
    const roundReportsLimit = resolveContextLimit(url.searchParams.get("roundReportsLimit"), DEFAULT_ROUND_REPORTS_LIMIT)

    const client = createRequestSupabaseClient(bearerToken)
    const jobsStartedAt = Date.now()
    const [supervisionsResult, usersResult, roundReportsResult] = await Promise.all([
      client
        .from("supervisions")
        .select(SUPERVISION_LIST_SUMMARY_SELECT)
        .order("created_at", { ascending: false })
        .limit(supervisionsLimit),
      client
        .from("users")
        .select("id,email,first_name")
        .order("first_name", { ascending: true })
        .limit(usersLimit),
      client
        .from("round_reports")
        .select(ROUND_REPORT_GROUPED_SUMMARY_SELECT)
        .order("created_at", { ascending: false })
        .limit(roundReportsLimit),
    ])
      measure("parallelJobsMs", jobsStartedAt, null)

    let supervisionsData = supervisionsResult.data
    let supervisionsError = supervisionsResult.error
    if (supervisionsError) {
      const fallbackStartedAt = Date.now()
      const fallback = await client
        .from("supervisions")
        .select(SUPERVISION_LIST_SUMMARY_SELECT_STABLE)
        .order("created_at", { ascending: false })
        .limit(supervisionsLimit)
      supervisionsData = fallback.data
      supervisionsError = fallback.error
      measure("supervisionsFallbackMs", fallbackStartedAt, null)
    }

    if (supervisionsError) {
      return NextResponse.json({ error: supervisionsError.message ?? "No se pudo cargar supervisiones agrupadas." }, { status: 500 })
    }

    if (usersResult.error) {
      return NextResponse.json({ error: usersResult.error.message ?? "No se pudieron cargar usuarios agrupados." }, { status: 500 })
    }

    if (roundReportsResult.error) {
      return NextResponse.json({ error: roundReportsResult.error.message ?? "No se pudieron cargar boletas de ronda agrupadas." }, { status: 500 })
    }

    timings.totalMs = Date.now() - requestStartedAt

    return NextResponse.json({
      supervisions: Array.isArray(supervisionsData) ? supervisionsData : [],
      users: Array.isArray(usersResult.data) ? usersResult.data : [],
      roundReports: Array.isArray(roundReportsResult.data) ? roundReportsResult.data : [],
      timings,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar supervisión agrupada." },
      { status: 500 }
    )
  }
}