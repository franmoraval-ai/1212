import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { SUPERVISION_DETAIL_SELECT_EXTENDED, SUPERVISION_DETAIL_SELECT_STABLE } from "@/lib/supervision-selects"

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
    const runQuery = (selectClause: string) => client
      .from("supervisions")
      .select(selectClause)
      .in("id", ids)

    let { data, error: queryError } = await runQuery(SUPERVISION_DETAIL_SELECT_EXTENDED)
    if (queryError) {
      const fallback = await runQuery(SUPERVISION_DETAIL_SELECT_STABLE)
      data = fallback.data
      queryError = fallback.error
    }

    if (queryError) {
      return NextResponse.json({ error: queryError.message ?? "No se pudo cargar detalle de supervisiones." }, { status: 500 })
    }

    return NextResponse.json({ rows: Array.isArray(data) ? data : [] })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar detalle de supervisiones." },
      { status: 500 }
    )
  }
}