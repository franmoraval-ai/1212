import { NextResponse } from "next/server"
import { writeAuditEvent } from "@/lib/audit-log"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { loadCommandOperationCatalog } from "@/lib/station-command-scope"

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

function isL3(actor: { roleLevel?: number | null }) {
  return Number(actor.roleLevel ?? 0) === 3
}

async function canManageCatalogEntry(
  admin: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]>,
  actor: NonNullable<Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]>,
  operationCatalogId: string
) {
  if (isDirector(actor)) return { allowed: true, error: null }
  if (!isL3(actor)) return { allowed: false, error: null }

  const scope = await loadCommandOperationCatalog(admin, actor)
  if (scope.error) return { allowed: false, error: scope.error }
  return {
    allowed: scope.rows.some((row) => String(row.id ?? "").trim() === operationCatalogId),
    error: null,
  }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const result = await loadCommandOperationCatalog(admin, actor)
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({
      operations: result.rows.map((row) => normalizeOperation(row as OperationCatalogRow)),
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

  if (!isDirector(actor) && !isL3(actor)) {
    return NextResponse.json({ error: "Solo L3 o L4 puede crear puestos operativos." }, { status: 403 })
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
    if (isL3(actor) && !isActive) {
      return NextResponse.json({ error: "Los puestos creados por L3 deben quedar activos." }, { status: 400 })
    }

    const { data: inserted, error: insertError } = await admin
      .from("operation_catalog")
      .insert({
        operation_name: operationName,
        client_name: clientName,
        is_active: isActive,
        created_at: createdAt,
      })
      .select("id")
      .maybeSingle()

    if (insertError) {
      const message = String(insertError.message ?? "No se pudo crear el puesto operativo.")
      const errorStatus = isDuplicateLikeError(message) ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    const insertedId = String(inserted?.id ?? "").trim()
    if (!insertedId) {
      return NextResponse.json({ error: "El puesto se creó, pero no se pudo resolver su identificador." }, { status: 500 })
    }

    if (isL3(actor)) {
      const { error: authorizationError } = await admin
        .from("station_officer_authorizations")
        .insert({
          operation_catalog_id: insertedId,
          officer_user_id: actor.userId,
          granted_by_user_id: actor.userId,
          is_active: true,
          valid_from: createdAt,
          valid_to: null,
        })

      if (authorizationError) {
        await admin.from("operation_catalog").delete().eq("id", insertedId)
        return NextResponse.json({ error: "No se pudo asignar el puesto nuevo al L3. La creación fue revertida." }, { status: 500 })
      }
    }

    await writeAuditEvent(admin, actor, {
      action: "operations.catalog.created",
      resourceType: "operation_catalog",
      metadata: { operationName, clientName, isActive },
    }, request)

    return NextResponse.json({ ok: true, id: insertedId })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando puesto operativo." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor) && !isL3(actor)) {
    return NextResponse.json({ error: "Solo L3 o L4 puede editar puestos operativos." }, { status: 403 })
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

    const access = await canManageCatalogEntry(admin, actor, id)
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: 500 })
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Solo puede editar puestos que estén bajo su cargo." }, { status: 403 })
    }

    if (!operationName || !clientName) {
      return NextResponse.json({ error: "Operacion y cliente son obligatorios." }, { status: 400 })
    }
    if (isL3(actor) && !isActive) {
      return NextResponse.json({ error: "Solo L4 puede pausar puestos operativos." }, { status: 403 })
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

    await writeAuditEvent(admin, actor, {
      action: "operations.catalog.updated",
      resourceType: "operation_catalog",
      resourceId: id,
      metadata: { operationName, clientName, isActive },
    }, request)

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

  if (!isDirector(actor) && !isL3(actor)) {
    return NextResponse.json({ error: "Solo L3 o L4 puede eliminar puestos operativos." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as OperationCatalogMutationBody
    const id = String(body.id ?? "").trim()
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const access = await canManageCatalogEntry(admin, actor, id)
    if (access.error) {
      return NextResponse.json({ error: access.error }, { status: 500 })
    }
    if (!access.allowed) {
      return NextResponse.json({ error: "Solo puede eliminar puestos que estén bajo su cargo." }, { status: 403 })
    }

    const { error: deleteError } = await admin
      .from("operation_catalog")
      .delete()
      .eq("id", id)

    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar el puesto operativo.") }, { status: 500 })
    }

    await writeAuditEvent(admin, actor, {
      action: "operations.catalog.deleted",
      resourceType: "operation_catalog",
      resourceId: id,
    }, request)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando puesto operativo." }, { status: 500 })
  }
}
