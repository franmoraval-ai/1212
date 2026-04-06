import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type PersonnelUserMutationBody = {
  id?: unknown
  roleLevel?: unknown
  status?: unknown
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeRoleLevel(value: unknown) {
  const numeric = Number(value)
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 4) return null
  return numeric
}

function normalizeStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase()
  if (["activo", "active"].includes(normalized)) return "Activo"
  if (["inactivo", "inactive"].includes(normalized)) return "Inactivo"
  return null
}

async function readUserById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("users")
    .select("id,role_level,status")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as { id?: string | null } | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar el usuario.") : null,
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar usuarios." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as PersonnelUserMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readUserById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row?.id) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if (body.roleLevel !== undefined) {
      const roleLevel = normalizeRoleLevel(body.roleLevel)
      if (roleLevel == null) {
        return NextResponse.json({ error: "roleLevel debe estar entre 1 y 4." }, { status: 400 })
      }
      updates.role_level = roleLevel
    }

    if (body.status !== undefined) {
      const normalizedStatus = normalizeStatus(body.status)
      if (!normalizedStatus) {
        return NextResponse.json({ error: "status debe ser Activo o Inactivo." }, { status: 400 })
      }
      updates.status = normalizedStatus
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from("users")
      .update(updates)
      .eq("id", id)

    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar el usuario.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando usuario." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar usuarios." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as PersonnelUserMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readUserById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row?.id) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 })
    }

    const { error: deleteError } = await admin
      .from("users")
      .delete()
      .eq("id", id)

    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar el usuario.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando usuario." }, { status: 500 })
  }
}