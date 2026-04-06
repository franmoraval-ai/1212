import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { ROUND_REPORT_GROUPED_SUMMARY_SELECT, SUPERVISION_LIST_SUMMARY_SELECT, SUPERVISION_LIST_SUMMARY_SELECT_STABLE } from "@/lib/supervision-selects"

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const [supervisionsResult, usersResult, roundReportsResult] = await Promise.all([
      client
        .from("supervisions")
        .select(SUPERVISION_LIST_SUMMARY_SELECT)
        .order("created_at", { ascending: false }),
      client
        .from("users")
        .select("id,email,first_name")
        .order("first_name", { ascending: true }),
      client
        .from("round_reports")
        .select(ROUND_REPORT_GROUPED_SUMMARY_SELECT)
        .order("created_at", { ascending: false }),
    ])

    let supervisionsData = supervisionsResult.data
    let supervisionsError = supervisionsResult.error
    if (supervisionsError) {
      const fallback = await client
        .from("supervisions")
        .select(SUPERVISION_LIST_SUMMARY_SELECT_STABLE)
        .order("created_at", { ascending: false })
      supervisionsData = fallback.data
      supervisionsError = fallback.error
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

    return NextResponse.json({
      supervisions: Array.isArray(supervisionsData) ? supervisionsData : [],
      users: Array.isArray(usersResult.data) ? usersResult.data : [],
      roundReports: Array.isArray(roundReportsResult.data) ? roundReportsResult.data : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar supervisión agrupada." },
      { status: 500 }
    )
  }
}