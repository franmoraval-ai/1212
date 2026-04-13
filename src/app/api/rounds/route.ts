import { NextResponse } from "next/server"
import { buildAssignedScope, splitAssignedScope } from "@/lib/personnel-assignment"
import { stationMatchesAssigned } from "@/lib/stations"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function isWindowActive(validFrom: unknown, validTo: unknown, now = Date.now()) {
  const from = validFrom ? new Date(String(validFrom)).getTime() : null
  const to = validTo ? new Date(String(validTo)).getTime() : null
  if (from && Number.isFinite(from) && from > now) return false
  if (to && Number.isFinite(to) && to < now) return false
  return true
}

function canManageRoundDefinitions(actor: { roleLevel: number }) {
  return Number(actor.roleLevel ?? 0) >= 2
}

async function loadActorScopedAssignments(admin: { from: (table: string) => any }, actor: { userId: string; assigned: string | null }) {
  const result = await admin
    .from("station_officer_authorizations")
    .select("is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(operation_name,client_name)")
    .eq("officer_user_id", actor.userId)
    .eq("is_active", true)

  if (result.error) {
    const fallback = normalizeText(actor.assigned)
    return fallback ? [fallback] : []
  }

  const scopes = ((result.data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => isWindowActive(row.valid_from, row.valid_to))
    .map((row) => {
      const catalog = Array.isArray(row.operation_catalog)
        ? (row.operation_catalog[0] as Record<string, unknown> | undefined)
        : (row.operation_catalog as Record<string, unknown> | null)
      const operationName = normalizeText(catalog?.operation_name)
      const clientName = normalizeText(catalog?.client_name)
      if (!operationName || !clientName) return ""
      return buildAssignedScope(operationName, clientName)
    })
    .filter(Boolean)

  if (scopes.length > 0) return scopes
  const fallback = normalizeText(actor.assigned)
  return fallback ? [fallback] : []
}

function isPostWithinScopes(post: string, scopes: string[]) {
  const candidate = normalizeText(post)
  if (!candidate) return false
  return scopes.some((scope) => stationMatchesAssigned(candidate, scope))
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!canManageRoundDefinitions(actor)) {
    return NextResponse.json({ error: "Solo L2-L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const roundName = normalizeText(body.name)
    const roundPost = normalizeText(body.post)
    if (!roundName || !roundPost) {
      return NextResponse.json({ error: "Nombre de ronda y puesto son obligatorios." }, { status: 400 })
    }

    if (!isDirector(actor)) {
      const scopes = await loadActorScopedAssignments(admin, { userId: actor.userId, assigned: actor.assigned })
      if (!isPostWithinScopes(roundPost, scopes)) {
        return NextResponse.json({ error: "El puesto de la ronda está fuera de su dominio autorizado." }, { status: 403 })
      }
    }

    const { error: insertError } = await admin.from("rounds").insert(body)
    if (insertError) {
      const message = String(insertError.message ?? "No se pudo crear la ronda.")
      const errorStatus = message.toLowerCase().includes("duplicate") ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando ronda." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!canManageRoundDefinitions(actor)) {
    return NextResponse.json({ error: "Solo L2-L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const payload = { ...body }
    delete payload.id
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    if (!isDirector(actor)) {
      const { data: currentRound, error: currentRoundError } = await admin
        .from("rounds")
        .select("post")
        .eq("id", id)
        .maybeSingle<{ post: string | null }>()

      if (currentRoundError) {
        return NextResponse.json({ error: "No se pudo validar el puesto actual de la ronda." }, { status: 500 })
      }

      const nextPost = normalizeText(payload.post ?? currentRound?.post ?? "")
      if (!nextPost) {
        return NextResponse.json({ error: "No se pudo determinar el puesto de la ronda." }, { status: 400 })
      }

      const scopes = await loadActorScopedAssignments(admin, { userId: actor.userId, assigned: actor.assigned })
      if (!isPostWithinScopes(nextPost, scopes)) {
        return NextResponse.json({ error: "El puesto de la ronda está fuera de su dominio autorizado." }, { status: 403 })
      }
    }

    const { error: updateError } = await admin.from("rounds").update(payload).eq("id", id)
    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar la ronda.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando ronda." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("rounds").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar la ronda.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando ronda." }, { status: 500 })
  }
}
