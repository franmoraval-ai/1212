import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

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