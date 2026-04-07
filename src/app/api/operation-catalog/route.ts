import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { splitAssignedScope } from "@/lib/personnel-assignment"

type OperationCatalogRow = {
  id: string
  operation_name?: string | null
  client_name?: string | null
  is_active?: boolean | null
}

type OperationCatalogMutationBody = {
  id?: string
  operationName?: string | null
  clientName?: string | null
  isActive?: boolean
  createdAt?: string | null
}

type StationOfficerAuthorizationRow = {
  is_active?: boolean | null
  valid_from?: string | null
  valid_to?: string | null
  operation_catalog?: OperationCatalogRow | OperationCatalogRow[] | null
}

function normalizeOperation(row: OperationCatalogRow) {
  return {
    id: String(row.id ?? ""),
    operationName: String(row.operation_name ?? ""),
    clientName: String(row.client_name ?? ""),
    isActive: row.is_active !== false,
  }
}

function normalizeCatalogText(value: unknown) {
  return String(value ?? "").trim().toUpperCase()
}

function isDuplicateLikeError(message: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("duplicate key value") || normalized.includes("already exists")
}

function isAuthorizationWindowActive(row: StationOfficerAuthorizationRow, now = Date.now()) {
  if (row.is_active === false) return false
  const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null
  const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null
  if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
  if (validTo && Number.isFinite(validTo) && validTo < now) return false
  return true
}

function fallbackOperationsFromAssigned(assignedRaw: string | null | undefined) {
  const { operationName, postName } = splitAssignedScope(assignedRaw)
  const normalizedOperation = normalizeCatalogText(operationName)
  const normalizedPost = normalizeCatalogText(postName)
  if (!normalizedOperation || !normalizedPost) return []
  return [{
    id: `${normalizedOperation}__${normalizedPost}`,
    operationName: normalizedOperation,
    clientName: normalizedPost,
    isActive: true,
  }]
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

  try {
    const client = createRequestSupabaseClient(bearerToken)
    if (Number(actor.roleLevel ?? 1) === 2) {
      const authorized = await client
        .from("station_officer_authorizations")
        .select("is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(id,operation_name,client_name,is_active)")
        .eq("officer_user_id", actor.userId)
        .eq("is_active", true)

      if (authorized.error) {
        return NextResponse.json({
          operations: fallbackOperationsFromAssigned(actor.assigned),
        })
      }

      const now = Date.now()
      const operations = ((authorized.data ?? []) as StationOfficerAuthorizationRow[])
        .filter((row) => isAuthorizationWindowActive(row, now))
        .map((row) => Array.isArray(row.operation_catalog) ? row.operation_catalog[0] : row.operation_catalog)
        .filter((row): row is OperationCatalogRow => {
          if (!row) return false
          return row.is_active !== false
        })
        .map((row) => normalizeOperation(row))

      if (operations.length === 0) {
        return NextResponse.json({
          operations: fallbackOperationsFromAssigned(actor.assigned),
        })
      }

      const deduped = Array.from(new Map(operations.map((operation) => [operation.id, operation])).values())
      return NextResponse.json({ operations: deduped })
    }

    const { data, error: queryError } = await client
      .from("operation_catalog")
      .select("id,operation_name,client_name,is_active")
      .order("operation_name", { ascending: true })

    if (queryError) {
      return NextResponse.json({ error: queryError.message ?? "No se pudo cargar el catálogo operativo." }, { status: 500 })
    }

    return NextResponse.json({
      operations: Array.isArray(data) ? data.map((row) => normalizeOperation(row as OperationCatalogRow)) : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el catálogo operativo." },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar el catálogo operativo." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as OperationCatalogMutationBody
    const operationName = normalizeCatalogText(body.operationName)
    const clientName = normalizeCatalogText(body.clientName)
    const isActive = body.isActive !== false
    const createdAt = String(body.createdAt ?? "").trim() || new Date().toISOString()

    if (!operationName || !clientName) {
      return NextResponse.json({ error: "Operacion y cliente son obligatorios." }, { status: 400 })
    }

    const { error: insertError } = await admin
      .from("operation_catalog")
      .insert({
        operation_name: operationName,
        client_name: clientName,
        is_active: isActive,
        created_at: createdAt,
      })

    if (insertError) {
      const message = String(insertError.message ?? "No se pudo crear el puesto operativo.")
      const errorStatus = isDuplicateLikeError(message) ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando puesto operativo." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar el catálogo operativo." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as OperationCatalogMutationBody
    const id = String(body.id ?? "").trim()
    const operationName = normalizeCatalogText(body.operationName)
    const clientName = normalizeCatalogText(body.clientName)
    const isActive = body.isActive !== false

    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    if (!operationName || !clientName) {
      return NextResponse.json({ error: "Operacion y cliente son obligatorios." }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from("operation_catalog")
      .update({
        operation_name: operationName,
        client_name: clientName,
        is_active: isActive,
      })
      .eq("id", id)

    if (updateError) {
      const message = String(updateError.message ?? "No se pudo actualizar el puesto operativo.")
      const errorStatus = isDuplicateLikeError(message) ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando puesto operativo." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar el catálogo operativo." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as OperationCatalogMutationBody
    const id = String(body.id ?? "").trim()
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const { error: deleteError } = await admin
      .from("operation_catalog")
      .delete()
      .eq("id", id)

    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar el puesto operativo.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando puesto operativo." }, { status: 500 })
  }
}
