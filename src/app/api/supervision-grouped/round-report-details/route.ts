import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { ROUND_REPORT_GROUPED_DETAIL_SELECT } from "@/lib/supervision-selects"

type DetailRequestBody = {
  ids?: string[]
}

export async function POST(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const body = (await request.json().catch(() => ({}))) as DetailRequestBody
  const ids = Array.from(new Set((body.ids ?? []).map((id) => String(id ?? "").trim()).filter(Boolean)))
  if (!ids.length) {
    return NextResponse.json({ rows: [] })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const { data, error: queryError } = await client
      .from("round_reports")
      .select(ROUND_REPORT_GROUPED_DETAIL_SELECT)
      .in("id", ids)

    if (queryError) {
      return NextResponse.json({ error: queryError.message ?? "No se pudo cargar detalle de boletas de ronda." }, { status: 500 })
    }

    return NextResponse.json({ rows: Array.isArray(data) ? data : [] })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar detalle de boletas de ronda." },
      { status: 500 }
    )
  }
}