import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type AuthorizationRow = {
  officer_user_id?: string | null
  operation_catalog_id?: string | null
  is_active?: boolean | null
  valid_from?: string | null
  valid_to?: string | null
}

function isAuthorizationSchemaMissing(message: string) {
  return String(message ?? "").toLowerCase().includes("station_officer_authorizations")
}

function isAuthorizationWindowActive(row: AuthorizationRow, now = Date.now()) {
  if (row.is_active === false) return false

  const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null
  const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null

  if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
  if (validTo && Number.isFinite(validTo) && validTo < now) return false
  return true
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar puestos autorizados por oficial." }, { status: 403 })
  }

  const url = new URL(request.url)
  const userId = String(url.searchParams.get("userId") ?? "").trim()
  if (!userId) {
    return NextResponse.json({ error: "Falta userId." }, { status: 400 })
  }

  const { data: targetUser, error: targetUserError } = await admin
    .from("users")
    .select("id,role_level")
    .eq("id", userId)
    .maybeSingle()

  if (targetUserError) {
    return NextResponse.json({ error: "No se pudo validar el oficial solicitado." }, { status: 500 })
  }

  if (!targetUser?.id) {
    return NextResponse.json({ error: "Oficial no encontrado." }, { status: 404 })
  }

  if (Number(targetUser.role_level ?? 1) >= 4) {
    return NextResponse.json({ error: "Los directores L4 no necesitan puestos autorizados (tienen acceso total)." }, { status: 400 })
  }

  const { data, error: authorizationError } = await admin
    .from("station_officer_authorizations")
    .select("officer_user_id,operation_catalog_id,is_active,valid_from,valid_to")
    .eq("officer_user_id", userId)

  if (authorizationError) {
    const message = String(authorizationError.message ?? "")
    if (isAuthorizationSchemaMissing(message)) {
      return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de administrar puestos por oficial." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudieron cargar los puestos autorizados del oficial." }, { status: 500 })
  }

  const operationCatalogIds = ((data ?? []) as AuthorizationRow[])
    .filter((row) => isAuthorizationWindowActive(row))
    .map((row) => String(row.operation_catalog_id ?? "").trim())
    .filter(Boolean)

  return NextResponse.json({ operationCatalogIds: Array.from(new Set(operationCatalogIds)) })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar puestos autorizados por oficial." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      userId?: string
      operationCatalogIds?: string[]
    }

    const userId = String(body.userId ?? "").trim()
    const operationCatalogIds = Array.from(new Set((Array.isArray(body.operationCatalogIds) ? body.operationCatalogIds : []).map((value) => String(value ?? "").trim()).filter(Boolean)))

    if (!userId) {
      return NextResponse.json({ error: "Falta userId." }, { status: 400 })
    }

    const { data: targetUser, error: userError } = await admin
      .from("users")
      .select("id,role_level")
      .eq("id", userId)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: "No se pudo validar el oficial solicitado." }, { status: 500 })
    }

    if (!targetUser?.id) {
      return NextResponse.json({ error: "Oficial no encontrado." }, { status: 404 })
    }

    if (Number(targetUser.role_level ?? 1) >= 4) {
      return NextResponse.json({ error: "Los directores L4 no necesitan puestos autorizados (tienen acceso total)." }, { status: 400 })
    }

    if (operationCatalogIds.length > 0) {
      const { data: validPosts, error: postsError } = await admin
        .from("operation_catalog")
        .select("id")
        .in("id", operationCatalogIds)

      if (postsError) {
        return NextResponse.json({ error: "No se pudo validar la lista de puestos seleccionados." }, { status: 500 })
      }

      const validIds = new Set(((validPosts ?? []) as Array<{ id?: string | null }>).map((row) => String(row.id ?? "").trim()).filter(Boolean))
      if (operationCatalogIds.some((id) => !validIds.has(id))) {
        return NextResponse.json({ error: "Uno o más puestos seleccionados ya no existen en el centro operativo." }, { status: 400 })
      }
    }

    const { data: existingRows, error: existingError } = await admin
      .from("station_officer_authorizations")
      .select("id,operation_catalog_id,is_active")
      .eq("officer_user_id", userId)

    if (existingError) {
      const message = String(existingError.message ?? "")
      if (isAuthorizationSchemaMissing(message)) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de administrar puestos por oficial." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo cargar el estado actual de puestos autorizados." }, { status: 500 })
    }

    const existingMap = new Map<string, { id: string; isActive: boolean }>()
    for (const row of (existingRows ?? []) as Array<{ id?: string | null; operation_catalog_id?: string | null; is_active?: boolean | null }>) {
      const operationCatalogId = String(row.operation_catalog_id ?? "").trim()
      const id = String(row.id ?? "").trim()
      if (!operationCatalogId || !id) continue
      existingMap.set(operationCatalogId, { id, isActive: row.is_active !== false })
    }

    const now = new Date().toISOString()
    const rowsToUpsert = operationCatalogIds.map((operationCatalogId) => ({
      operation_catalog_id: operationCatalogId,
      officer_user_id: userId,
      granted_by_user_id: actor.userId,
      is_active: true,
      valid_from: existingMap.get(operationCatalogId)?.isActive ? null : now,
      valid_to: null,
    }))

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await admin
        .from("station_officer_authorizations")
        .upsert(rowsToUpsert, { onConflict: "operation_catalog_id,officer_user_id" })

      if (upsertError) {
        return NextResponse.json({ error: `No se pudieron guardar los puestos autorizados del oficial. Detalle: ${String(upsertError.message ?? "Error desconocido")}` }, { status: 500 })
      }
    }

    const rowsToDeactivate = Array.from(existingMap.keys()).filter((operationCatalogId) => !operationCatalogIds.includes(operationCatalogId))

    if (rowsToDeactivate.length > 0) {
      const { error: deactivateError } = await admin
        .from("station_officer_authorizations")
        .update({ is_active: false, valid_to: now, granted_by_user_id: actor.userId })
        .eq("officer_user_id", userId)
        .in("operation_catalog_id", rowsToDeactivate)

      if (deactivateError) {
        return NextResponse.json({ error: `No se pudieron revocar algunos puestos del oficial. Detalle: ${String(deactivateError.message ?? "Error desconocido")}` }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, authorizedCount: operationCatalogIds.length })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando puestos autorizados del oficial." }, { status: 500 })
  }
}
