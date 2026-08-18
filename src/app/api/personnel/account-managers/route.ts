import { NextResponse } from "next/server"
import { writeAuditEvent } from "@/lib/audit-log"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

type AccountManagerAssignment = {
  operationCatalogId?: unknown
  l3UserId?: unknown
}

type AssignmentRow = {
  operation_catalog_id?: string | null
  l3_user_id?: string | null
  is_active?: boolean | null
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function isSchemaMissing(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("l2_account_manager_assignments")
    && (normalized.includes("does not exist") || normalized.includes("schema cache") || normalized.includes("not find"))
}

async function readL2(admin: { from: (table: string) => any }, userId: string) {
  const { data, error } = await admin
    .from("users")
    .select("id,role_level")
    .eq("id", userId)
    .maybeSingle()

  if (error) return { row: null, error: String(error.message ?? "No se pudo validar el L2.") }
  if (!data?.id) return { row: null, error: "Usuario no encontrado.", status: 404 }
  if (Number(data.role_level ?? 0) !== 2) return { row: null, error: "Las asignaciones por cuenta solo aplican a usuarios L2.", status: 400 }
  return { row: data, error: null }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  if (!isDirector(actor)) return NextResponse.json({ error: "Solo nivel 4 puede administrar responsables por cuenta." }, { status: 403 })

  const userId = normalizeText(new URL(request.url).searchParams.get("userId"))
  if (!userId) return NextResponse.json({ error: "Falta userId." }, { status: 400 })

  const l2 = await readL2(admin, userId)
  if (l2.error) return NextResponse.json({ error: l2.error }, { status: l2.status ?? 500 })

  const { data, error: assignmentsError } = await admin
    .from("l2_account_manager_assignments")
    .select("operation_catalog_id,l3_user_id,is_active")
    .eq("l2_user_id", userId)
    .eq("is_active", true)

  if (assignmentsError) {
    const message = String(assignmentsError.message ?? "")
    if (isSchemaMissing(message)) {
      return NextResponse.json({ error: "Aplique la migración supabase/add_l2_account_manager_assignments.sql." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudieron cargar los responsables por cuenta." }, { status: 500 })
  }

  const assignments = ((Array.isArray(data) ? data : []) as AssignmentRow[])
    .map((row) => ({
      operationCatalogId: normalizeText(row.operation_catalog_id),
      l3UserId: normalizeText(row.l3_user_id),
    }))
    .filter((row) => row.operationCatalogId && row.l3UserId)

  return NextResponse.json({ assignments })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  if (!isDirector(actor)) return NextResponse.json({ error: "Solo nivel 4 puede administrar responsables por cuenta." }, { status: 403 })

  try {
    const body = (await request.json()) as { userId?: unknown; assignments?: AccountManagerAssignment[] }
    const userId = normalizeText(body.userId)
    if (!userId) return NextResponse.json({ error: "Falta userId." }, { status: 400 })

    const l2 = await readL2(admin, userId)
    if (l2.error) return NextResponse.json({ error: l2.error }, { status: l2.status ?? 500 })

    const assignmentMap = new Map<string, string>()
    for (const assignment of Array.isArray(body.assignments) ? body.assignments : []) {
      const operationCatalogId = normalizeText(assignment.operationCatalogId)
      const l3UserId = normalizeText(assignment.l3UserId)
      if (!operationCatalogId || !l3UserId) continue
      assignmentMap.set(operationCatalogId, l3UserId)
    }

    const operationCatalogIds = Array.from(assignmentMap.keys())
    const l3UserIds = Array.from(new Set(assignmentMap.values()))

    if (operationCatalogIds.length > 0) {
      const [{ data: accounts, error: accountsError }, { data: managers, error: managersError }] = await Promise.all([
        admin.from("operation_catalog").select("id").in("id", operationCatalogIds),
        admin.from("users").select("id,role_level,status").in("id", l3UserIds),
      ])

      if (accountsError || managersError) {
        return NextResponse.json({ error: "No se pudieron validar las cuentas y responsables seleccionados." }, { status: 500 })
      }

      const validAccountIds = new Set((accounts ?? []).map((row: { id?: unknown }) => normalizeText(row.id)).filter(Boolean))
      if (operationCatalogIds.some((id) => !validAccountIds.has(id))) {
        return NextResponse.json({ error: "Una o más cuentas ya no existen." }, { status: 400 })
      }

      const validL3Ids = new Set((managers ?? [])
        .filter((row: { role_level?: unknown; status?: unknown }) => (
          Number(row.role_level ?? 0) === 3
          && ["activo", "active"].includes(normalizeText(row.status).toLowerCase())
        ))
        .map((row: { id?: unknown }) => normalizeText(row.id))
        .filter(Boolean))
      if (l3UserIds.some((id) => !validL3Ids.has(id))) {
        return NextResponse.json({ error: "Cada responsable debe ser un L3 activo." }, { status: 400 })
      }
    }

    const { data: existing, error: existingError } = await admin
      .from("l2_account_manager_assignments")
      .select("operation_catalog_id,l3_user_id,is_active")
      .eq("l2_user_id", userId)

    if (existingError) {
      const message = String(existingError.message ?? "")
      if (isSchemaMissing(message)) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_l2_account_manager_assignments.sql." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo cargar la jerarquía actual." }, { status: 500 })
    }

    const rows = Array.from(assignmentMap, ([operationCatalogId, l3UserId]) => ({
      operation_catalog_id: operationCatalogId,
      l2_user_id: userId,
      l3_user_id: l3UserId,
      assigned_by_user_id: actor.userId,
      is_active: true,
      updated_at: new Date().toISOString(),
    }))

    if (rows.length > 0) {
      const { error: upsertError } = await admin
        .from("l2_account_manager_assignments")
        .upsert(rows, { onConflict: "operation_catalog_id,l2_user_id" })
      if (upsertError) return NextResponse.json({ error: "No se pudieron guardar los responsables por cuenta." }, { status: 500 })
    }

    const removedAccountIds = ((existing ?? []) as AssignmentRow[])
      .map((row) => normalizeText(row.operation_catalog_id))
      .filter((id) => id && !assignmentMap.has(id))

    if (removedAccountIds.length > 0) {
      const { error: deactivateError } = await admin
        .from("l2_account_manager_assignments")
        .update({ is_active: false, assigned_by_user_id: actor.userId, updated_at: new Date().toISOString() })
        .eq("l2_user_id", userId)
        .in("operation_catalog_id", removedAccountIds)
      if (deactivateError) return NextResponse.json({ error: "No se pudieron retirar asignaciones anteriores." }, { status: 500 })
    }

    await writeAuditEvent(admin, actor, {
      action: "personnel.l2_account_managers.updated",
      resourceType: "user",
      resourceId: userId,
      metadata: {
        previousCount: ((existing ?? []) as AssignmentRow[]).filter((row) => row.is_active !== false).length,
        assignedCount: rows.length,
        operationCatalogIds,
      },
    }, request)

    return NextResponse.json({ ok: true, assignedCount: rows.length })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando responsables por cuenta." }, { status: 500 })
  }
}
