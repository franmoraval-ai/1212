import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { stationMatchesAssigned } from "@/lib/stations"

const INTERNAL_NOTES_SLA_HOURS = Math.max(1, Number(process.env.NEXT_PUBLIC_INTERNAL_NOTES_SLA_HOURS ?? 24))

type InternalNoteRow = {
  id: string
  post_name?: string | null
  category?: string | null
  priority?: string | null
  detail?: string | null
  status?: string | null
  reported_by_user_id?: string | null
  reported_by_name?: string | null
  reported_by_email?: string | null
  assigned_to?: string | null
  resolution_note?: string | null
  created_at?: string | null
  updated_at?: string | null
  resolved_at?: string | null
}

type InternalNoteMutationBody = {
  id?: unknown
  postName?: unknown
  category?: unknown
  priority?: unknown
  detail?: unknown
  status?: unknown
  assignedTo?: unknown
  resolutionNote?: unknown
  resolvedAt?: unknown
  updatedAt?: unknown
  createdAt?: unknown
  reportedByName?: unknown
}

function normalizeInternalNote(row: InternalNoteRow) {
  return {
    id: String(row.id ?? ""),
    postName: String(row.post_name ?? ""),
    category: String(row.category ?? ""),
    priority: String(row.priority ?? ""),
    detail: String(row.detail ?? ""),
    status: String(row.status ?? ""),
    reportedByUserId: String(row.reported_by_user_id ?? ""),
    reportedByName: String(row.reported_by_name ?? ""),
    reportedByEmail: String(row.reported_by_email ?? ""),
    assignedTo: String(row.assigned_to ?? ""),
    resolutionNote: String(row.resolution_note ?? ""),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    resolvedAt: row.resolved_at ?? null,
  }
}

function isOverdue(createdAt: string | null, status: string | null) {
  if (String(status ?? "abierta").trim().toLowerCase() === "resuelta") return false
  if (!createdAt) return false
  const createdAtMs = new Date(createdAt).getTime()
  if (!Number.isFinite(createdAtMs)) return false
  return Date.now() - createdAtMs >= INTERNAL_NOTES_SLA_HOURS * 60 * 60 * 1000
}

function applyOwnNotesScope(query: any, actor: { uid: string; email: string; roleLevel: number }) {
  if (Number(actor.roleLevel ?? 1) !== 1) return query

  const userId = String(actor.uid ?? "").trim()
  const email = String(actor.email ?? "").trim().toLowerCase()

  if (userId && email) {
    return query.or(`reported_by_user_id.eq.${userId},reported_by_email.eq.${email}`)
  }

  if (userId) {
    return query.eq("reported_by_user_id", userId)
  }

  if (email) {
    return query.eq("reported_by_email", email)
  }

  return query
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
    const scopedQuery = applyOwnNotesScope(
      client
        .from("internal_notes")
        .select("id,post_name,category,priority,detail,status,reported_by_user_id,reported_by_name,reported_by_email,assigned_to,resolution_note,created_at,updated_at,resolved_at")
        .order("created_at", { ascending: false }),
      actor
    )

    const { data, error: queryError } = await scopedQuery
    if (queryError) {
      return NextResponse.json({ error: queryError.message ?? "No se pudieron cargar las novedades internas." }, { status: 500 })
    }

    const notes = (Array.isArray(data) ? data : []).map(normalizeInternalNote)
    const openCount = notes.filter((note) => String(note.status ?? "abierta") !== "resuelta").length
    const overdueCount = notes.filter((note) => isOverdue(note.createdAt, note.status)).length

    return NextResponse.json({
      notes,
      openCount,
      overdueCount,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudieron cargar las novedades internas." },
      { status: 500 }
    )
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeStatus(value: unknown) {
  return normalizeText(value) || "abierta"
}

function buildInternalNoteInsertRow(
  body: InternalNoteMutationBody,
  actor: { uid: string; email: string; firstName?: string | null }
) {
  const createdAt = normalizeText(body.createdAt) || new Date().toISOString()
  const updatedAt = normalizeText(body.updatedAt) || createdAt

  return {
    post_name: normalizeText(body.postName),
    category: normalizeText(body.category) || "otro",
    priority: normalizeText(body.priority) || "media",
    detail: normalizeText(body.detail),
    status: normalizeStatus(body.status),
    reported_by_user_id: String(actor.uid ?? "").trim() || null,
    reported_by_name: normalizeText(body.reportedByName) || String(actor.firstName ?? actor.email ?? "Operador").trim() || "Operador",
    reported_by_email: String(actor.email ?? "").trim().toLowerCase() || null,
    assigned_to: normalizeText(body.assignedTo) || null,
    resolution_note: normalizeText(body.resolutionNote) || null,
    resolved_at: normalizeText(body.resolvedAt) || null,
    updated_at: updatedAt,
    created_at: createdAt,
  }
}

function buildInternalNoteUpdateRow(body: InternalNoteMutationBody) {
  const row: Record<string, unknown> = {}
  if (body.status !== undefined) row.status = normalizeStatus(body.status)
  if (body.assignedTo !== undefined) row.assigned_to = normalizeText(body.assignedTo) || null
  if (body.resolutionNote !== undefined) row.resolution_note = normalizeText(body.resolutionNote) || null
  if (body.resolvedAt !== undefined) row.resolved_at = normalizeText(body.resolvedAt) || null
  if (body.updatedAt !== undefined) row.updated_at = normalizeText(body.updatedAt) || new Date().toISOString()
  if (body.detail !== undefined) row.detail = normalizeText(body.detail)
  if (body.priority !== undefined) row.priority = normalizeText(body.priority) || "media"
  if (body.category !== undefined) row.category = normalizeText(body.category) || "otro"
  if (body.postName !== undefined) row.post_name = normalizeText(body.postName)
  return row
}

function canManageInternalNote(
  actor: { uid: string; email: string; assigned?: string | null; roleLevel: number },
  note: InternalNoteRow
) {
  const roleLevel = Number(actor.roleLevel ?? 1)
  if (roleLevel >= 3) return true
  if (roleLevel < 2) return false

  const userId = String(actor.uid ?? "").trim()
  const email = String(actor.email ?? "").trim().toLowerCase()
  const reportedByUserId = String(note.reported_by_user_id ?? "").trim()
  const reportedByEmail = String(note.reported_by_email ?? "").trim().toLowerCase()

  if (userId && reportedByUserId && reportedByUserId === userId) return true
  if (email && reportedByEmail && reportedByEmail === email) return true

  return stationMatchesAssigned(note.post_name, actor.assigned)
}

async function readInternalNoteById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("internal_notes")
    .select("id,post_name,reported_by_user_id,reported_by_email,status")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as InternalNoteRow | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar la novedad interna.") : null,
  }
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as InternalNoteMutationBody
    const row = buildInternalNoteInsertRow(body, actor)

    if (!normalizeText(row.post_name) || !normalizeText(row.detail)) {
      return NextResponse.json({ error: "Puesto y detalle son obligatorios." }, { status: 400 })
    }

    const { error: insertError } = await admin.from("internal_notes").insert(row)
    if (insertError) {
      return NextResponse.json({ error: String(insertError.message ?? "No se pudo crear la novedad interna.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando la novedad interna." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as InternalNoteMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readInternalNoteById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Novedad interna no encontrada." }, { status: 404 })
    }

    if (!canManageInternalNote(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para actualizar esta novedad interna." }, { status: 403 })
    }

    const row = buildInternalNoteUpdateRow(body)
    if (Object.keys(row).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin.from("internal_notes").update(row).eq("id", id)
    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar la novedad interna.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando la novedad interna." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as InternalNoteMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readInternalNoteById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Novedad interna no encontrada." }, { status: 404 })
    }

    if (!canManageInternalNote(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para eliminar esta novedad interna." }, { status: 403 })
    }

    const currentStatus = String(current.row.status ?? "abierta").trim().toLowerCase()
    if (currentStatus !== "resuelta") {
      return NextResponse.json({ error: "Solo se puede eliminar una novedad interna resuelta." }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("internal_notes").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar la novedad interna.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando la novedad interna." }, { status: 500 })
  }
}