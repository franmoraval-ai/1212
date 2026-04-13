import { NextResponse } from "next/server"
import { buildAssignedScope } from "@/lib/personnel-assignment"
import { stationMatchesAssigned } from "@/lib/stations"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import {
  SUPERVISION_DETAIL_SELECT_EXTENDED,
  SUPERVISION_DETAIL_SELECT_STABLE,
  SUPERVISION_LIST_SUMMARY_SELECT,
  SUPERVISION_LIST_SUMMARY_SELECT_STABLE,
} from "@/lib/supervision-selects"

type SupervisionRow = {
  id: string
  supervisor_id?: string | null
}

const SUPERVISION_COMPAT_COLUMNS = ["officer_phone", "evidence_bundle", "geo_risk"] as const

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function hasCompatColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return SUPERVISION_COMPAT_COLUMNS.some((column) => normalized.includes(column))
}

function stripCompatColumns<TRecord extends Record<string, unknown>>(row: TRecord) {
  const next = { ...row }
  for (const column of SUPERVISION_COMPAT_COLUMNS) {
    delete next[column]
  }
  return next
}

function canManageSupervision(actor: { uid: string; email: string; roleLevel: number }, row: SupervisionRow) {
  if (Number(actor.roleLevel ?? 0) >= 4) return true

  const actorUid = normalizeText(actor.uid).toLowerCase()
  const actorEmail = normalizeText(actor.email).toLowerCase()
  const supervisorId = normalizeText(row.supervisor_id).toLowerCase()

  if (!supervisorId) return false
  return supervisorId === actorUid || supervisorId === actorEmail
}

function isWindowActive(validFrom: unknown, validTo: unknown, now = Date.now()) {
  const from = validFrom ? new Date(String(validFrom)).getTime() : null
  const to = validTo ? new Date(String(validTo)).getTime() : null
  if (from && Number.isFinite(from) && from > now) return false
  if (to && Number.isFinite(to) && to < now) return false
  return true
}

async function loadActorScopes(admin: { from: (table: string) => any }, actor: { userId: string; assigned: string | null }) {
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

function isSupervisionInScope(row: Record<string, unknown>, scopes: string[]) {
  if (scopes.length === 0) return false
  const post = normalizeText(row.review_post)
  const operation = normalizeText(row.operation_name)
  return scopes.some((scope) => stationMatchesAssigned(post, scope) || stationMatchesAssigned(operation, scope))
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readSupervisionById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("supervisions")
    .select("id,supervisor_id")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as SupervisionRow | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar la supervision.") : null,
  }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const roleLevel = Number(actor.roleLevel ?? 0)
  if (roleLevel < 2) {
    return NextResponse.json({ error: "Solo L2-L4 puede consultar supervisiones." }, { status: 403 })
  }

  const actorScopes = isDirector(actor) ? [] : await loadActorScopes(admin, { userId: actor.userId, assigned: actor.assigned })

  const url = new URL(request.url)
  const id = String(url.searchParams.get("id") ?? "").trim()
  const ids = Array.from(new Set(String(url.searchParams.get("ids") ?? "").split(",").map((value) => value.trim()).filter(Boolean)))

  const runDetailQuery = (selectClause: string, targetIds: string[]) => {
    if (targetIds.length === 1) {
      return admin
        .from("supervisions")
        .select(selectClause)
        .eq("id", targetIds[0])
    }

    return admin
      .from("supervisions")
      .select(selectClause)
      .in("id", targetIds)
  }

  if (id) {
    let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, [id]).maybeSingle()

    if (detailError) {
      const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, [id]).maybeSingle()
      data = fallback.data
      detailError = fallback.error
    }

    if (detailError) {
      return NextResponse.json({ error: "No se pudo cargar el detalle de la supervision." }, { status: 500 })
    }

    if (!isDirector(actor) && isObjectRecord(data) && !isSupervisionInScope(data, actorScopes)) {
      return NextResponse.json({ error: "La supervision está fuera de su dominio autorizado." }, { status: 403 })
    }

    return NextResponse.json({ ok: true, record: data ?? null })
  }

  if (ids.length > 0) {
    let { data, error: detailError } = await runDetailQuery(SUPERVISION_DETAIL_SELECT_EXTENDED, ids)

    if (detailError) {
      const fallback = await runDetailQuery(SUPERVISION_DETAIL_SELECT_STABLE, ids)
      data = fallback.data
      detailError = fallback.error
    }

    if (detailError) {
      return NextResponse.json({ error: "No se pudo cargar el detalle de supervisiones." }, { status: 500 })
    }

    const records = Array.isArray(data) ? data : []
    const scopedRecords = isDirector(actor)
      ? records
      : records.filter((row) => isObjectRecord(row) && isSupervisionInScope(row, actorScopes))

    return NextResponse.json({ ok: true, records: scopedRecords })
  }

  const runListQuery = (selectClause: string) => admin
    .from("supervisions")
    .select(selectClause)
    .order("created_at", { ascending: false })

  let { data, error: listError } = await runListQuery(SUPERVISION_LIST_SUMMARY_SELECT)

  if (listError) {
    const fallbackResult = await runListQuery(SUPERVISION_LIST_SUMMARY_SELECT_STABLE)
    data = fallbackResult.data
    listError = fallbackResult.error
  }

  if (listError) {
    return NextResponse.json({ error: "No se pudo cargar la lista de supervisiones." }, { status: 500 })
  }

  const records = Array.isArray(data) ? data : []
  const scopedRecords = isDirector(actor)
    ? records
    : records.filter((row) => isObjectRecord(row) && isSupervisionInScope(row, actorScopes))

  return NextResponse.json({ ok: true, records: scopedRecords })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const row: Record<string, unknown> = {
      ...body,
      supervisor_id: actor.email || actor.uid,
    }

    if (!normalizeText(row.operation_name) || !normalizeText(row.review_post) || !normalizeText(row.officer_name) || !normalizeText(row.id_number)) {
      return NextResponse.json({ error: "Operacion, cliente, oficial y cedula son obligatorios." }, { status: 400 })
    }

    let { error: insertError } = await admin.from("supervisions").insert(row)
    let warning: string | null = null

    if (insertError && hasCompatColumnError(insertError.message)) {
      const fallback = await admin.from("supervisions").insert(stripCompatColumns(row))
      insertError = fallback.error
      if (!insertError) {
        warning = "Su base de datos aun no tiene todas las columnas nuevas. Ejecute supabase/fix_officer_phone_schema_cache.sql."
      }
    }

    if (insertError) {
      const message = String(insertError.message ?? "No se pudo registrar la supervision.")
      const normalized = message.toLowerCase()
      const errorStatus = normalized.includes("payload too large") || normalized.includes("request entity too large") || normalized.includes("413") || normalized.includes("too large")
        ? 413
        : normalized.includes("duplicate")
          ? 409
          : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true, warning })
  } catch {
    return NextResponse.json({ error: "Error inesperado registrando supervision." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readSupervisionById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Supervision no encontrada." }, { status: 404 })
    }

    if (!canManageSupervision(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para actualizar esta supervision." }, { status: 403 })
    }

    const payload = { ...body }
    delete payload.id
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from("supervisions")
      .update(payload)
      .eq("id", id)

    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar la supervision.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando supervision." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readSupervisionById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Supervision no encontrada." }, { status: 404 })
    }

    if (!canManageSupervision(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para eliminar esta supervision." }, { status: 403 })
    }

    const { error: deleteError } = await admin
      .from("supervisions")
      .delete()
      .eq("id", id)

    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar la supervision.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando supervision." }, { status: 500 })
  }
}
