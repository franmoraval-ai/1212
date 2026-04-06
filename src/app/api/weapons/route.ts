import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor, isManager } from "@/lib/server-auth"

type WeaponRow = {
  id: string
  model?: string | null
  serial?: string | null
  type?: string | null
  status?: string | null
  assigned_to?: string | null
  ammo_count?: number | null
  last_check?: string | null
  location?: unknown
}

type WeaponMutationRecord = {
  model?: unknown
  serial?: unknown
  type?: unknown
  status?: unknown
  assignedTo?: unknown
  ammoCount?: unknown
  lastCheck?: unknown
  location?: unknown
}

type WeaponMutationBody = WeaponMutationRecord & {
  id?: unknown
  records?: WeaponMutationRecord[]
}

function normalizeWeapon(row: WeaponRow) {
  return {
    id: String(row.id ?? ""),
    model: String(row.model ?? ""),
    serial: String(row.serial ?? ""),
    type: String(row.type ?? ""),
    status: String(row.status ?? ""),
    assignedTo: String(row.assigned_to ?? ""),
    ammoCount: Number(row.ammo_count ?? 0),
    lastCheck: row.last_check ? String(row.last_check) : null,
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeAmmoValue(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.trunc(parsed))
}

function hasAmmoColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("ammo_count") || normalized.includes("ammocount")
}

function buildWeaponInsertRow(record: WeaponMutationRecord) {
  return {
    model: normalizeText(record.model),
    serial: normalizeText(record.serial),
    type: normalizeText(record.type),
    status: normalizeText(record.status),
    assigned_to: normalizeText(record.assignedTo),
    ammo_count: normalizeAmmoValue(record.ammoCount),
    last_check: normalizeText(record.lastCheck) || null,
    location: record.location ?? null,
  }
}

function buildWeaponUpdateRow(record: WeaponMutationRecord) {
  const row: Record<string, unknown> = {}
  if (record.status !== undefined) row.status = normalizeText(record.status)
  if (record.assignedTo !== undefined) row.assigned_to = normalizeText(record.assignedTo)
  if (record.ammoCount !== undefined) row.ammo_count = normalizeAmmoValue(record.ammoCount)
  if (record.lastCheck !== undefined) row.last_check = normalizeText(record.lastCheck) || null
  if (record.location !== undefined) row.location = record.location ?? null
  if (record.model !== undefined) row.model = normalizeText(record.model)
  if (record.serial !== undefined) row.serial = normalizeText(record.serial)
  if (record.type !== undefined) row.type = normalizeText(record.type)
  return row
}

function stripAmmoColumn<TRecord extends Record<string, unknown>>(value: TRecord | TRecord[]) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const next = { ...item }
      delete next.ammo_count
      return next
    })
  }

  const next = { ...value }
  delete next.ammo_count
  return next
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
      .from("weapons")
      .select("id,model,serial,type,status,assigned_to,ammo_count,last_check")
      .order("serial", { ascending: true })

    if (queryError) {
      return NextResponse.json({ error: queryError.message ?? "No se pudo cargar armamento." }, { status: 500 })
    }

    return NextResponse.json({
      weapons: Array.isArray(data) ? data.map((row) => normalizeWeapon(row as WeaponRow)) : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar armamento." },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isManager(actor)) {
    return NextResponse.json({ error: "Solo L3-L4 puede administrar armamento." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as WeaponMutationBody
    const records = Array.isArray(body.records) ? body.records : [body]
    const rows = records.map(buildWeaponInsertRow)

    if (rows.some((row) => !normalizeText(row.model) || !normalizeText(row.serial))) {
      return NextResponse.json({ error: "Modelo y serie son obligatorios." }, { status: 400 })
    }

    let { error: insertError } = await admin.from("weapons").insert(rows)
    if (insertError && hasAmmoColumnError(insertError.message)) {
      const fallback = await admin.from("weapons").insert(stripAmmoColumn(rows))
      insertError = fallback.error
    }

    if (insertError) {
      const message = String(insertError.message ?? "No se pudo registrar armamento.")
      const errorStatus = message.toLowerCase().includes("duplicate key value") ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true, insertedCount: rows.length })
  } catch {
    return NextResponse.json({ error: "Error inesperado registrando armamento." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isManager(actor)) {
    return NextResponse.json({ error: "Solo L3-L4 puede administrar armamento." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as WeaponMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const row = buildWeaponUpdateRow(body)
    if (Object.keys(row).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    let { error: updateError } = await admin.from("weapons").update(row).eq("id", id)
    if (updateError && hasAmmoColumnError(updateError.message) && "ammo_count" in row) {
      const fallback = await admin.from("weapons").update(stripAmmoColumn(row)).eq("id", id)
      updateError = fallback.error
    }

    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar armamento.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando armamento." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isManager(actor)) {
    return NextResponse.json({ error: "Solo L3-L4 puede administrar armamento." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as WeaponMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("weapons").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar armamento.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando armamento." }, { status: 500 })
  }
}