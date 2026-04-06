import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { stationMatchesAssigned } from "@/lib/stations"

type IncidentRow = {
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
}

const INCIDENT_COMPAT_COLUMNS = ["evidence_bundle", "geo_risk_level", "geo_risk_flags", "estimated_speed_kmh"] as const

function normalizeIncident(row: IncidentRow) {
  return {
    id: String(row.id ?? ""),
    time: row.time ?? null,
    createdAt: row.created_at ?? null,
    incidentType: String(row.incident_type ?? ""),
    location: String(row.location ?? row.lugar ?? ""),
    description: String(row.description ?? ""),
    priorityLevel: String(row.priority_level ?? ""),
    status: String(row.status ?? "Abierto"),
    reportedByUserId: String(row.reported_by_user_id ?? ""),
    reportedByEmail: String(row.reported_by_email ?? ""),
  }
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizePriority(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || "Medium"
}

function normalizeStatus(value: unknown) {
  const normalized = normalizeText(value)
  return normalized || "Abierto"
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
    status: normalizeStatus(body.status),
    photos: body.photos ?? null,
    evidence_bundle: body.evidenceBundle ?? null,
    geo_risk_level: normalizeText(body.geoRiskLevel) || null,
    geo_risk_flags: Array.isArray(body.geoRiskFlags) ? body.geoRiskFlags : null,
    estimated_speed_kmh: typeof body.estimatedSpeedKmh === "number" ? body.estimatedSpeedKmh : body.estimatedSpeedKmh ?? null,
  }
}

function buildIncidentUpdateRow(body: IncidentMutationBody) {
  const row: Record<string, unknown> = {}
  if (body.status !== undefined) row.status = normalizeStatus(body.status)
  if (body.description !== undefined) row.description = normalizeText(body.description)
  if (body.priorityLevel !== undefined) row.priority_level = normalizePriority(body.priorityLevel)
  if (body.reasoning !== undefined) row.reasoning = normalizeText(body.reasoning) || null
  if (body.location !== undefined) row.location = normalizeText(body.location) || null
  if (body.lugar !== undefined) row.lugar = normalizeText(body.lugar) || null
  if (body.incidentType !== undefined) row.incident_type = normalizeText(body.incidentType)
  if (body.title !== undefined) row.title = normalizeText(body.title) || null
  if (body.reportedBy !== undefined) row.reported_by = normalizeText(body.reportedBy) || null
  return row
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

function canManageIncident(actor: { uid: string; email: string; assigned?: string | null; roleLevel: number }, incident: IncidentRow) {
  const roleLevel = Number(actor.roleLevel ?? 1)
  if (roleLevel >= 3) return true
  if (roleLevel < 2) return false

  const userId = String(actor.uid ?? "").trim()
  const email = String(actor.email ?? "").trim().toLowerCase()
  const reportedByUserId = String(incident.reported_by_user_id ?? "").trim()
  const reportedByEmail = String(incident.reported_by_email ?? "").trim().toLowerCase()

  if (userId && reportedByUserId && reportedByUserId === userId) return true
  if (email && reportedByEmail && reportedByEmail === email) return true

  const assigned = String(actor.assigned ?? "").trim()
  return stationMatchesAssigned(incident.location, assigned) || stationMatchesAssigned(incident.lugar, assigned)
}

async function readIncidentById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("incidents")
    .select("id,location,lugar,reported_by_user_id,reported_by_email")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as IncidentRow | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar el incidente.") : null,
  }
}

async function readRows<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const incidentsResult = await readRows<IncidentRow>(
      client
        .from("incidents")
        .select("id,time,created_at,incident_type,location,lugar,description,priority_level,status,reported_by_user_id,reported_by_email")
        .order("time", { ascending: false })
    )

    if (incidentsResult.error) {
      return NextResponse.json({ error: incidentsResult.error }, { status: 500 })
    }

    return NextResponse.json({
      incidents: incidentsResult.rows.map(normalizeIncident),
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

    const row = buildIncidentUpdateRow(body)
    if (Object.keys(row).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin.from("incidents").update(row).eq("id", id)
    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar el incidente.") }, { status: 500 })
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

    const { error: deleteError } = await admin.from("incidents").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar el incidente.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando incidente." }, { status: 500 })
  }
}