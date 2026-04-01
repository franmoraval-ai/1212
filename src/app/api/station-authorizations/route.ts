import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type OfficerRow = {
  id: string
  email?: string | null
  first_name?: string | null
  status?: string | null
  assigned?: string | null
}

type AuthorizationRow = {
  id: string
  officer_user_id?: string | null
  is_active?: boolean | null
  valid_from?: string | null
  valid_to?: string | null
  notes?: string | null
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function isAuthorizationSchemaMissing(message: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("station_officer_authorizations")
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar oficiales autorizados por puesto." }, { status: 403 })
  }

  const url = new URL(request.url)
  const operationCatalogId = String(url.searchParams.get("operationCatalogId") ?? "").trim()
  if (!operationCatalogId) {
    return NextResponse.json({ error: "Falta operationCatalogId." }, { status: 400 })
  }

  const { data: operation, error: operationError } = await admin
    .from("operation_catalog")
    .select("id,operation_name,client_name,is_active")
    .eq("id", operationCatalogId)
    .maybeSingle()

  if (operationError) {
    return NextResponse.json({ error: "No se pudo cargar el puesto solicitado." }, { status: 500 })
  }

  if (!operation?.id) {
    return NextResponse.json({ error: "Puesto no encontrado." }, { status: 404 })
  }

  const { data: officers, error: officersError } = await admin
    .from("users")
    .select("id,email,first_name,status,assigned")
    .eq("role_level", 1)

  if (officersError) {
    return NextResponse.json({ error: "No se pudo cargar la lista de oficiales." }, { status: 500 })
  }

  const { data: authorizations, error: authorizationsError } = await admin
    .from("station_officer_authorizations")
    .select("id,officer_user_id,is_active,valid_from,valid_to,notes")
    .eq("operation_catalog_id", operationCatalogId)

  if (authorizationsError) {
    const message = String(authorizationsError.message ?? "")
    if (isAuthorizationSchemaMissing(message)) {
      return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de administrar autorizaciones por puesto." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudieron cargar las autorizaciones del puesto." }, { status: 500 })
  }

  const authorizationMap = new Map<string, AuthorizationRow>()
  for (const row of (authorizations ?? []) as AuthorizationRow[]) {
    const officerUserId = String(row.officer_user_id ?? "").trim()
    if (!officerUserId) continue
    authorizationMap.set(officerUserId, row)
  }

  const mappedOfficers = ((officers ?? []) as OfficerRow[])
    .filter((row) => ["", "activo", "active"].includes(normalizeStatus(row.status)))
    .map((row) => {
      const authorization = authorizationMap.get(String(row.id ?? "").trim())
      return {
        id: String(row.id),
        name: String(row.first_name ?? row.email ?? "Oficial").trim() || "Oficial",
        email: String(row.email ?? "").trim().toLowerCase(),
        status: String(row.status ?? "").trim(),
        assigned: String(row.assigned ?? "").trim(),
        isAuthorized: Boolean(authorization?.is_active),
        validFrom: authorization?.valid_from ?? null,
        validTo: authorization?.valid_to ?? null,
        notes: authorization?.notes ?? null,
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, "es", { sensitivity: "base" }))

  return NextResponse.json({
    operation: {
      id: String(operation.id),
      operationName: String(operation.operation_name ?? ""),
      clientName: String(operation.client_name ?? ""),
      isActive: operation.is_active !== false,
    },
    officers: mappedOfficers,
  })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar oficiales autorizados por puesto." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      operationCatalogId?: string
      officerUserIds?: string[]
    }

    const operationCatalogId = String(body.operationCatalogId ?? "").trim()
    const officerUserIds = Array.from(new Set((Array.isArray(body.officerUserIds) ? body.officerUserIds : []).map((value) => String(value ?? "").trim()).filter(Boolean)))

    if (!operationCatalogId) {
      return NextResponse.json({ error: "Falta operationCatalogId." }, { status: 400 })
    }

    const { data: operation, error: operationError } = await admin
      .from("operation_catalog")
      .select("id")
      .eq("id", operationCatalogId)
      .maybeSingle()

    if (operationError) {
      return NextResponse.json({ error: "No se pudo validar el puesto solicitado." }, { status: 500 })
    }

    if (!operation?.id) {
      return NextResponse.json({ error: "Puesto no encontrado." }, { status: 404 })
    }

    const { data: l1Officers, error: l1Error } = await admin
      .from("users")
      .select("id")
      .eq("role_level", 1)
      .in("id", officerUserIds.length > 0 ? officerUserIds : ["00000000-0000-0000-0000-000000000000"])

    if (l1Error) {
      return NextResponse.json({ error: "No se pudo validar la lista de oficiales." }, { status: 500 })
    }

    const validOfficerIds = new Set(((l1Officers ?? []) as Array<{ id?: string | null }>).map((row) => String(row.id ?? "").trim()).filter(Boolean))
    if (officerUserIds.some((id) => !validOfficerIds.has(id))) {
      return NextResponse.json({ error: "Solo se pueden autorizar usuarios L1 válidos." }, { status: 400 })
    }

    const { data: existingRows, error: existingError } = await admin
      .from("station_officer_authorizations")
      .select("id,officer_user_id,is_active")
      .eq("operation_catalog_id", operationCatalogId)

    if (existingError) {
      const message = String(existingError.message ?? "")
      if (isAuthorizationSchemaMissing(message)) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de administrar autorizaciones por puesto." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo cargar el estado actual de autorizaciones." }, { status: 500 })
    }

    const existingMap = new Map<string, { id: string; isActive: boolean }>()
    for (const row of (existingRows ?? []) as Array<{ id?: string | null; officer_user_id?: string | null; is_active?: boolean | null }>) {
      const officerUserId = String(row.officer_user_id ?? "").trim()
      const id = String(row.id ?? "").trim()
      if (!officerUserId || !id) continue
      existingMap.set(officerUserId, { id, isActive: row.is_active !== false })
    }

    const now = new Date().toISOString()
    const rowsToUpsert = officerUserIds.map((officerUserId) => ({
      operation_catalog_id: operationCatalogId,
      officer_user_id: officerUserId,
      granted_by_user_id: actor.uid,
      is_active: true,
      valid_from: existingMap.get(officerUserId)?.isActive ? undefined : now,
      valid_to: null,
    }))

    if (rowsToUpsert.length > 0) {
      const { error: upsertError } = await admin
        .from("station_officer_authorizations")
        .upsert(rowsToUpsert, { onConflict: "operation_catalog_id,officer_user_id" })

      if (upsertError) {
        return NextResponse.json({ error: "No se pudieron guardar las autorizaciones seleccionadas." }, { status: 500 })
      }
    }

    const rowsToDeactivate = Array.from(existingMap.entries())
      .filter(([officerUserId]) => !validOfficerIds.has(officerUserId) || !officerUserIds.includes(officerUserId))
      .map(([officerUserId]) => officerUserId)

    if (rowsToDeactivate.length > 0) {
      const { error: deactivateError } = await admin
        .from("station_officer_authorizations")
        .update({ is_active: false, valid_to: now, granted_by_user_id: actor.uid })
        .eq("operation_catalog_id", operationCatalogId)
        .in("officer_user_id", rowsToDeactivate)

      if (deactivateError) {
        return NextResponse.json({ error: "No se pudieron revocar algunas autorizaciones." }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, authorizedCount: officerUserIds.length })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando autorizaciones por puesto." }, { status: 500 })
  }
}