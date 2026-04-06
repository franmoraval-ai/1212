import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"

type SupervisionRow = {
  review_post?: string | null
}

type WeaponRow = {
  id: string
  model?: string | null
  serial?: string | null
  status?: string | null
  assigned_to?: string | null
  ammo_count?: number | null
}

async function readRows<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

function normalizeWeapon(row: WeaponRow) {
  return {
    id: String(row.id ?? ""),
    model: String(row.model ?? ""),
    serial: String(row.serial ?? ""),
    status: String(row.status ?? ""),
    assignedTo: String(row.assigned_to ?? ""),
    ammoCount: Number(row.ammo_count ?? 0),
  }
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (Number(actor.roleLevel ?? 0) !== 2) {
    return NextResponse.json({ suggestedPosts: [], weapons: [] })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const [supervisionsResult, weaponsResult] = await Promise.all([
      readRows<SupervisionRow>(
        client
          .from("supervisions")
          .select("review_post")
          .order("created_at", { ascending: false })
          .limit(200)
      ),
      readRows<WeaponRow>(
        client
          .from("weapons")
          .select("id,model,serial,status,assigned_to,ammo_count")
          .order("serial", { ascending: false })
      ),
    ])

    const suggestedPosts = Array.from(
      new Set(
        supervisionsResult.rows
          .map((row) => String(row.review_post ?? "").trim())
          .filter(Boolean)
      )
    ).slice(0, 40)

    const warnings = [
      supervisionsResult.error ? `supervisions:${supervisionsResult.error}` : null,
      weaponsResult.error ? `weapons:${weaponsResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      suggestedPosts,
      weapons: weaponsResult.rows.map(normalizeWeapon),
      warnings,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el contexto de control de armas." },
      { status: 500 }
    )
  }
}