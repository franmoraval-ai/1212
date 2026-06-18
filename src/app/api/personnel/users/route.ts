import { NextResponse } from "next/server"
import { isManagerHierarchySchemaMissing } from "@/lib/manager-hierarchy"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type PersonnelUserMutationBody = {
  id?: unknown
  roleLevel?: unknown
  status?: unknown
  managerUserId?: unknown
}

type PersonnelUserRow = {
  id?: string | null
  role_level?: number | null
  status?: string | null
  manager_user_id?: string | null
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

function isActiveStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized === "activo" || normalized === "active"
}

async function readUserById(admin: { from: (table: string) => any }, id: string) {
  let { data, error } = await admin
    .from("users")
    .select("id,role_level,status,manager_user_id")
    .eq("id", id)
    .maybeSingle()

  if (error && isManagerHierarchySchemaMissing(String(error.message ?? ""))) {
    const fallback = await admin
      .from("users")
      .select("id,role_level,status")
      .eq("id", id)
      .maybeSingle()
    data = fallback.data
    error = fallback.error
  }

  return {
    row: (data as PersonnelUserRow | null) ?? null,
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
    let nextRoleLevel = Number(current.row.role_level ?? 1)

    if (body.roleLevel !== undefined) {
      const roleLevel = normalizeRoleLevel(body.roleLevel)
      if (roleLevel == null) {
        return NextResponse.json({ error: "roleLevel debe estar entre 1 y 4." }, { status: 400 })
      }
      updates.role_level = roleLevel
      nextRoleLevel = roleLevel
    }

    if (body.status !== undefined) {
      const normalizedStatus = normalizeStatus(body.status)
      if (!normalizedStatus) {
        return NextResponse.json({ error: "status debe ser Activo o Inactivo." }, { status: 400 })
      }
      updates.status = normalizedStatus
    }

    if (body.managerUserId !== undefined) {
      const managerUserId = normalizeText(body.managerUserId)

      if (!managerUserId) {
        updates.manager_user_id = null
      } else {
        if (![1, 3].includes(nextRoleLevel)) {
          return NextResponse.json({ error: "Solo usuarios L1 o L3 pueden quedar bajo cargo de un L3." }, { status: 400 })
        }

        if (managerUserId === id) {
          return NextResponse.json({ error: "Un usuario no puede quedar a cargo de sí mismo." }, { status: 400 })
        }

        const manager = await readUserById(admin, managerUserId)
        if (manager.error) {
          return NextResponse.json({ error: manager.error }, { status: 500 })
        }

        if (!manager.row?.id) {
          return NextResponse.json({ error: "El L3 responsable no fue encontrado." }, { status: 404 })
        }

        if (Number(manager.row.role_level ?? 0) !== 3) {
          return NextResponse.json({ error: "El responsable asignado debe ser un usuario L3." }, { status: 400 })
        }

        if (!isActiveStatus(manager.row.status)) {
          return NextResponse.json({ error: "El responsable L3 debe estar activo." }, { status: 400 })
        }

        updates.manager_user_id = managerUserId
      }
    } else if (String(current.row.manager_user_id ?? "").trim() && ![1, 3].includes(nextRoleLevel)) {
      updates.manager_user_id = null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from("users")
      .update(updates)
      .eq("id", id)

    if (updateError) {
      if (isManagerHierarchySchemaMissing(String(updateError.message ?? ""))) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_user_manager_hierarchy.sql antes de usar jerarquía L3." }, { status: 503 })
      }
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar el usuario.") }, { status: 500 })
    }

    if (body.roleLevel !== undefined && Number(current.row.role_level ?? 0) === 3 && nextRoleLevel !== 3) {
      const { error: clearDependantsError } = await admin
        .from("users")
        .update({ manager_user_id: null })
        .eq("manager_user_id", id)

      if (clearDependantsError) {
        if (isManagerHierarchySchemaMissing(String(clearDependantsError.message ?? ""))) {
          return NextResponse.json({ error: "Aplique la migración supabase/add_user_manager_hierarchy.sql antes de usar jerarquía L3." }, { status: 503 })
        }
        return NextResponse.json({ error: String(clearDependantsError.message ?? "No se pudo limpiar la jerarquía del usuario.") }, { status: 500 })
      }
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