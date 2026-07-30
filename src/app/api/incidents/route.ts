import { NextResponse } from "next/server"
import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { canManageIncident, canViewIncident, type IncidentAccessRow } from "@/lib/incident-access"
import { canAlertOfficer } from "@/lib/push-authorization"
import { getAuthenticatedActor } from "@/lib/server-auth"

const DEFAULT_INCIDENTS_LIMIT = 400
const MAX_INCIDENTS_LIMIT = 1000
const INCIDENT_STATUS_VALUES = ["Abierto", "En curso", "Cerrado"] as const

type IncidentStatus = typeof INCIDENT_STATUS_VALUES[number]

type IncidentRow = IncidentAccessRow & {
  id: string
  title?: string | null
  time?: string | null
  created_at?: string | null
  incident_type?: string | null
  location?: string | null
  lugar?: string | null
  description?: string | null
  priority_level?: string | null
  reasoning?: string | null
  reported_by?: string | null
  status?: string | null
  reported_by_user_id?: string | null
  reported_by_email?: string | null
  resolution_note?: string | null
  resolved_at?: string | null
  resolved_by_user_id?: string | null
  resolved_by_email?: string | null
  assigned_to_user_id?: string | null
  assigned_to_email?: string | null
  assigned_to_name?: string | null
  assigned_at?: string | null
  assigned_by_user_id?: string | null
  assigned_by_email?: string | null
}

type IncidentAssigneeRow = {
  id?: string | null
  first_name?: string | null
  email?: string | null
  role_level?: number | null
  status?: string | null
  assigned?: string | null
}

type IncidentMutationBody = {
  id?: unknown
  title?: unknown
  description?: unknown
  incidentType?: unknown
  location?: unknown
  lugar?: unknown
  time?: unknown
  priorityLevel?: unknown
  reasoning?: unknown
  reportedBy?: unknown
  status?: unknown
  photos?: unknown
  evidenceBundle?: unknown
  geoRiskLevel?: unknown
  geoRiskFlags?: unknown
  estimatedSpeedKmh?: unknown
  resolutionNote?: unknown
  assignedToUserId?: unknown
}

const INCIDENT_COMPAT_COLUMNS = [
  "evidence_bundle",
  "geo_risk_level",
  "geo_risk_flags",
  "estimated_speed_kmh",
  "resolution_note",
  "resolved_at",
  "resolved_by_user_id",
  "resolved_by_email",
  "assigned_to_user_id",
  "assigned_to_email",
  "assigned_to_name",
  "assigned_at",
  "assigned_by_user_id",
  "assigned_by_email",
] as const

const INCIDENT_LIST_SELECT_EXTENDED = [
  "id", "time", "created_at", "incident_type", "location", "lugar", "description", "priority_level", "status", "reported_by_user_id", "reported_by_email",
  "resolution_note", "resolved_at", "resolved_by_user_id", "resolved_by_email",
  "assigned_to_user_id", "assigned_to_email", "assigned_to_name", "assigned_at", "assigned_by_user_id", "assigned_by_email",
].join(",")

const INCIDENT_LIST_SELECT_STABLE = [
  "id", "time", "created_at", "incident_type", "location", "lugar", "description", "priority_level", "status", "reported_by_user_id", "reported_by_email",
].join(",")

function normalizeIncident(row: IncidentRow) {
  return {
    id: String(row.id ?? ""),
    time: row.time ?? null,
    createdAt: row.created_at ?? null,
    incidentType: String(row.incident_type ?? ""),
    location: String(row.location ?? row.lugar ?? ""),
    description: String(row.description ?? ""),
    priorityLevel: String(row.priority_level ?? ""),
    status: normalizeIncidentStatus(row.status, "Abierto") ?? "Abierto",
    reportedByUserId: String(row.reported_by_user_id ?? ""),
    reportedByEmail: String(row.reported_by_email ?? ""),
    resolutionNote: String(row.resolution_note ?? ""),
    resolvedAt: row.resolved_at ?? null,
    resolvedByUserId: String(row.resolved_by_user_id ?? ""),
    resolvedByEmail: String(row.resolved_by_email ?? ""),
    assignedToUserId: String(row.assigned_to_user_id ?? ""),
    assignedToEmail: String(row.assigned_to_email ?? ""),
    assignedToName: String(row.assigned_to_name ?? ""),
    assignedAt: row.assigned_at ?? null,
    assignedByUserId: String(row.assigned_by_user_id ?? ""),
    assignedByEmail: String(row.assigned_by_email ?? ""),
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizePriority(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || "Medium"
}

function normalizeIncidentStatus(value: unknown, fallback: IncidentStatus | null) {
  const normalized = normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\s_-]+/g, " ")

  if (!normalized) return fallback
  if (normalized === "abierto" || normalized === "pendiente") return "Abierto"
  if (normalized === "en curso" || normalized === "en progreso" || normalized === "progreso") return "En curso"
  if (normalized === "cerrado" || normalized === "cerrada") return "Cerrado"
  return null
}

function isActiveUserStatus(value: unknown) {
  const normalized = normalizeText(value).toLowerCase()
  return normalized === "activo" || normalized === "active"
}

function normalizeIncidentAssignee(row: IncidentAssigneeRow) {
  return {
    id: normalizeText(row.id),
    name: normalizeText(row.first_name),
    email: normalizeText(row.email).toLowerCase(),
    roleLevel: Number(row.role_level ?? 1),
    assigned: normalizeText(row.assigned),
  }
}

function isAssignableIncidentUser(row: IncidentAssigneeRow) {
  const roleLevel = Number(row.role_level ?? 1)
  return Boolean(normalizeText(row.id)) && isActiveUserStatus(row.status) && roleLevel >= 1 && roleLevel < 4
}

function buildIncidentInsertRow(body: IncidentMutationBody, actor: { uid: string; email: string }) {
  const time = normalizeText(body.time) || new Date().toISOString()
  const location = normalizeText(body.location)
  const lugar = normalizeText(body.lugar) || location || null

  return {
    title: normalizeText(body.title) || null,
    description: normalizeText(body.description),
    incident_type: normalizeText(body.incidentType),
    location: location || null,
    lugar,
    time,
    priority_level: normalizePriority(body.priorityLevel),
    reasoning: normalizeText(body.reasoning) || null,
    reported_by: normalizeText(body.reportedBy) || null,
    reported_by_user_id: String(actor.uid ?? "").trim() || null,
    reported_by_email: String(actor.email ?? "").trim().toLowerCase() || null,
    status: normalizeIncidentStatus(body.status, "Abierto"),
    photos: body.photos ?? null,
    evidence_bundle: body.evidenceBundle ?? null,
    geo_risk_level: normalizeText(body.geoRiskLevel) || null,
    geo_risk_flags: Array.isArray(body.geoRiskFlags) ? body.geoRiskFlags : null,
    estimated_speed_kmh: typeof body.estimatedSpeedKmh === "number" ? body.estimatedSpeedKmh : body.estimatedSpeedKmh ?? null,
  }
}

function buildIncidentUpdateRow(body: IncidentMutationBody, actor: { uid: string; email: string }) {
  const row: Record<string, unknown> = {}
  if (body.status !== undefined) {
    const status = normalizeIncidentStatus(body.status, null)
    if (!status) return { row, error: "Estado de incidente no válido." }
    row.status = status
  }
  if (body.description !== undefined) row.description = normalizeText(body.description)
  if (body.priorityLevel !== undefined) row.priority_level = normalizePriority(body.priorityLevel)
  if (body.reasoning !== undefined) row.reasoning = normalizeText(body.reasoning) || null
  if (body.location !== undefined) row.location = normalizeText(body.location) || null
  if (body.lugar !== undefined) row.lugar = normalizeText(body.lugar) || null
  if (body.incidentType !== undefined) row.incident_type = normalizeText(body.incidentType)
  if (body.title !== undefined) row.title = normalizeText(body.title) || null
  if (body.reportedBy !== undefined) row.reported_by = normalizeText(body.reportedBy) || null

  if (row.status === "Cerrado") {
    const resolutionNote = normalizeText(body.resolutionNote)
    if (!resolutionNote) {
      return { row, error: "Cerrar un incidente requiere documentar la resolución." }
    }
    row.resolution_note = resolutionNote
    row.resolved_at = new Date().toISOString()
    row.resolved_by_user_id = String(actor.uid ?? "").trim() || null
    row.resolved_by_email = String(actor.email ?? "").trim().toLowerCase() || null
  }

  return { row, error: null }
}

async function assignIncidentOwner(
  admin: { from: (table: string) => any },
  actor: { uid: string; userId: string; email: string; assigned: string | null; roleLevel: number },
  body: IncidentMutationBody,
  row: Record<string, unknown>
) {
  if (body.assignedToUserId === undefined) return null

  const assigneeId = normalizeText(body.assignedToUserId)
  if (!assigneeId) {
    row.assigned_to_user_id = null
    row.assigned_to_email = null
    row.assigned_to_name = null
    row.assigned_at = null
    row.assigned_by_user_id = null
    row.assigned_by_email = null
    return null
  }

  const { data, error } = await admin
    .from("users")
    .select("id,first_name,email,role_level,status,assigned")
    .eq("id", assigneeId)
    .maybeSingle()
  if (error) return "No se pudo validar el responsable asignado."

  const assignee = (data as IncidentAssigneeRow | null) ?? null
  if (!assignee || !isAssignableIncidentUser(assignee)) {
    return "El responsable debe ser un usuario operativo activo."
  }

  const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
  if (managedTeamError) return managedTeamError

  const normalizedAssignee = normalizeIncidentAssignee(assignee)
  if (!canAlertOfficer(actor, managedTeamScope, normalizedAssignee)) {
    return "El responsable está fuera de su ámbito autorizado."
  }

  row.assigned_to_user_id = normalizedAssignee.id
  row.assigned_to_email = normalizedAssignee.email || null
  row.assigned_to_name = normalizedAssignee.name || null
  row.assigned_at = new Date().toISOString()
  row.assigned_by_user_id = String(actor.uid ?? "").trim() || null
  row.assigned_by_email = String(actor.email ?? "").trim().toLowerCase() || null
  return null
}

function stripCompatColumns<TRecord extends Record<string, unknown>>(row: TRecord) {
  const next = { ...row }
  for (const column of INCIDENT_COMPAT_COLUMNS) {
    delete next[column]
  }
  return next
}

function hasCompatColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return INCIDENT_COMPAT_COLUMNS.some((column) => normalized.includes(column))
}

async function readIncidentById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("incidents")
    .select("id,location,lugar,status,reported_by_user_id,reported_by_email")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as IncidentRow | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar el incidente.") : null,
  }
}

async function readRows<T>(promise: PromiseLike<{ data: unknown; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data as T[] : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

function resolveIncidentsLimit(url: URL) {
  const raw = String(url.searchParams.get("limit") ?? "").trim()
  if (!raw) return DEFAULT_INCIDENTS_LIMIT

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_INCIDENTS_LIMIT
  return Math.min(parsed, MAX_INCIDENTS_LIMIT)
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const url = new URL(request.url)
    const limit = resolveIncidentsLimit(url)
    const includeAssignees = url.searchParams.get("includeAssignees") === "1"

    const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
    if (managedTeamError) {
      return NextResponse.json({ error: managedTeamError }, { status: 500 })
    }

    const readIncidentList = (selectClause: string) => admin
      .from("incidents")
      .select(selectClause)
      .order("time", { ascending: false })
      .limit(limit)

    let incidentsResult = await readRows<IncidentRow>(
      readIncidentList(INCIDENT_LIST_SELECT_EXTENDED)
    )

    if (incidentsResult.error && hasCompatColumnError(incidentsResult.error)) {
      incidentsResult = await readRows<IncidentRow>(readIncidentList(INCIDENT_LIST_SELECT_STABLE))
    }

    if (incidentsResult.error) {
      return NextResponse.json({ error: incidentsResult.error }, { status: 500 })
    }

    let assignees: Array<ReturnType<typeof normalizeIncidentAssignee>> = []
    if (includeAssignees && Number(actor.roleLevel ?? 1) >= 2) {
      const { data, error: assigneesError } = await admin
        .from("users")
        .select("id,first_name,email,role_level,status,assigned")
        .order("first_name", { ascending: true })
        .limit(1000)

      if (assigneesError) {
        return NextResponse.json({ error: "No se pudo cargar la lista de responsables." }, { status: 500 })
      }

      assignees = ((data ?? []) as IncidentAssigneeRow[])
        .filter(isAssignableIncidentUser)
        .map(normalizeIncidentAssignee)
        .filter((candidate) => canAlertOfficer(actor, managedTeamScope, candidate))
    }

    return NextResponse.json({
      incidents: incidentsResult.rows.filter((row) => canViewIncident(actor, managedTeamScope, row)).map(normalizeIncident),
      assignees,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudieron cargar los incidentes." },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as IncidentMutationBody
    const row = buildIncidentInsertRow(body, actor)

    if (!row.status) {
      return NextResponse.json({ error: "Estado de incidente no válido." }, { status: 400 })
    }

    if (!normalizeText(row.description) || !normalizeText(row.incident_type) || !normalizeText(row.location ?? row.lugar)) {
      return NextResponse.json({ error: "Tipo, ubicacion y descripcion son obligatorios." }, { status: 400 })
    }

    let { error: insertError } = await admin.from("incidents").insert(row)
    if (insertError && hasCompatColumnError(insertError.message)) {
      const fallback = await admin.from("incidents").insert(stripCompatColumns(row))
      insertError = fallback.error
    }

    if (insertError) {
      const message = String(insertError.message ?? "No se pudo registrar el incidente.")
      const errorStatus = message.toLowerCase().includes("too large") || message.includes("413") ? 413 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado registrando incidente." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as IncidentMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readIncidentById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Incidente no encontrado." }, { status: 404 })
    }

    if (!canManageIncident(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para actualizar este incidente." }, { status: 403 })
    }

    const currentStatus = normalizeIncidentStatus(current.row.status, "Abierto")
    if (currentStatus === "Cerrado") {
      return NextResponse.json({
        error: "Un incidente cerrado no admite cambios; registre un seguimiento o use una acción de auditoría específica.",
      }, { status: 400 })
    }

    if (body.assignedToUserId !== undefined && normalizeText(current.row.status) === "Cerrado") {
      return NextResponse.json({ error: "No se puede asignar un incidente cerrado." }, { status: 400 })
    }

    const update = buildIncidentUpdateRow(body, actor)
    if (update.error) {
      return NextResponse.json({ error: update.error }, { status: 400 })
    }
    const row = update.row
    const assignmentError = await assignIncidentOwner(admin, actor, body, row)
    if (assignmentError) {
      return NextResponse.json({ error: assignmentError }, { status: 400 })
    }
    if (Object.keys(row).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    let { error: updateError } = await admin.from("incidents").update(row).eq("id", id)
    if (updateError && hasCompatColumnError(updateError.message) && row.status !== "Cerrado") {
      const fallback = await admin.from("incidents").update(stripCompatColumns(row)).eq("id", id)
      updateError = fallback.error
    }
    if (updateError) {
      const message = String(updateError.message ?? "No se pudo actualizar el incidente.")
      if (row.status === "Cerrado" && hasCompatColumnError(message)) {
        return NextResponse.json({
          error: "El cierre trazable requiere aplicar supabase/add_incident_resolution_tracking.sql.",
        }, { status: 503 })
      }
      return NextResponse.json({ error: message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando incidente." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json()) as IncidentMutationBody
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const current = await readIncidentById(admin, id)
    if (current.error) {
      return NextResponse.json({ error: current.error }, { status: 500 })
    }

    if (!current.row) {
      return NextResponse.json({ error: "Incidente no encontrado." }, { status: 404 })
    }

    if (!canManageIncident(actor, current.row)) {
      return NextResponse.json({ error: "Sin permiso para eliminar este incidente." }, { status: 403 })
    }

    if (normalizeIncidentStatus(current.row.status, "Abierto") === "Cerrado") {
      return NextResponse.json({
        error: "No se puede eliminar un incidente cerrado porque conserva evidencia y seguimiento.",
      }, { status: 400 })
    }

    const { data: followUps, error: followUpsError } = await admin
      .from("incident_follow_ups")
      .select("id")
      .eq("incident_id", id)
      .limit(1)
    if (followUpsError) {
      return NextResponse.json({
        error: "No se puede verificar el seguimiento; aplique supabase/create_incident_follow_ups.sql.",
      }, { status: 503 })
    }
    if (Array.isArray(followUps) && followUps.length > 0) {
      return NextResponse.json({
        error: "No se puede eliminar un incidente con seguimientos registrados.",
      }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("incidents").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar el incidente.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando incidente." }, { status: 500 })
  }
}