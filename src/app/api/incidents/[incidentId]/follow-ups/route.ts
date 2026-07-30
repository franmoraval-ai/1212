import { NextResponse } from "next/server"
import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { canManageIncident, canViewIncident, type IncidentAccessRow } from "@/lib/incident-access"
import { getAuthenticatedActor } from "@/lib/server-auth"

const MAX_FOLLOW_UPS = 200
const MAX_FOLLOW_UP_LENGTH = 2000

type FollowUpRow = {
  id?: string | null
  note?: string | null
  created_at?: string | null
  created_by_user_id?: string | null
  created_by_email?: string | null
  created_by_name?: string | null
}

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeFollowUp(row: FollowUpRow) {
  return {
    id: normalizeText(row.id),
    note: normalizeText(row.note),
    createdAt: row.created_at ?? null,
    createdByUserId: normalizeText(row.created_by_user_id),
    createdByEmail: normalizeText(row.created_by_email),
    createdByName: normalizeText(row.created_by_name),
  }
}

async function readIncidentAccessRow(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("incidents")
    .select("id,location,lugar,reported_by_user_id,reported_by_email")
    .eq("id", id)
    .maybeSingle()

  return {
    row: (data as IncidentAccessRow | null) ?? null,
    error: error ? String(error.message ?? "No se pudo validar el incidente.") : null,
  }
}

async function authorizeFollowUpAccess(
  admin: { from: (table: string) => any },
  actor: { uid: string; userId: string; email: string; assigned: string | null; roleLevel: number },
  incidentId: string,
  requireManage: boolean
) {
  const incident = await readIncidentAccessRow(admin, incidentId)
  if (incident.error) return { error: incident.error, status: 500 }
  if (!incident.row) return { error: "Incidente no encontrado.", status: 404 }

  if (requireManage) {
    if (Number(actor.roleLevel ?? 1) < 2 || !canManageIncident(actor, incident.row)) {
      return { error: "Sin permiso para registrar seguimiento en este incidente.", status: 403 }
    }
    return { error: null, status: 200 }
  }

  const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
  if (managedTeamError) return { error: managedTeamError, status: 500 }
  if (!canViewIncident(actor, managedTeamScope, incident.row)) {
    return { error: "Sin permiso para ver el seguimiento de este incidente.", status: 403 }
  }

  return { error: null, status: 200 }
}

export async function GET(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const { incidentId } = await params
  const id = normalizeText(incidentId)
  if (!id) return NextResponse.json({ error: "Falta incidentId." }, { status: 400 })

  const authorization = await authorizeFollowUpAccess(admin, actor, id, false)
  if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status })

  const { data, error: followUpsError } = await admin
    .from("incident_follow_ups")
    .select("id,note,created_at,created_by_user_id,created_by_email,created_by_name")
    .eq("incident_id", id)
    .order("created_at", { ascending: false })
    .limit(MAX_FOLLOW_UPS)

  if (followUpsError) {
    return NextResponse.json({
      error: "El seguimiento requiere aplicar supabase/create_incident_follow_ups.sql.",
    }, { status: 503 })
  }

  return NextResponse.json({
    followUps: Array.isArray(data) ? data.map((row) => normalizeFollowUp(row as FollowUpRow)) : [],
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ incidentId: string }> }) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const { incidentId } = await params
  const id = normalizeText(incidentId)
  if (!id) return NextResponse.json({ error: "Falta incidentId." }, { status: 400 })

  let body: { note?: unknown }
  try {
    body = await request.json() as { note?: unknown }
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 })
  }

  const note = normalizeText(body.note)
  if (!note) return NextResponse.json({ error: "El seguimiento no puede estar vacío." }, { status: 400 })
  if (note.length > MAX_FOLLOW_UP_LENGTH) {
    return NextResponse.json({ error: `El seguimiento no puede exceder ${MAX_FOLLOW_UP_LENGTH} caracteres.` }, { status: 400 })
  }

  const authorization = await authorizeFollowUpAccess(admin, actor, id, true)
  if (authorization.error) return NextResponse.json({ error: authorization.error }, { status: authorization.status })

  const { error: insertError } = await admin
    .from("incident_follow_ups")
    .insert({
      incident_id: id,
      note,
      created_by_user_id: String(actor.uid ?? "").trim() || null,
      created_by_email: String(actor.email ?? "").trim().toLowerCase() || null,
      created_by_name: String(actor.firstName ?? actor.email ?? "").trim() || null,
    })

  if (insertError) {
    return NextResponse.json({
      error: "El seguimiento requiere aplicar supabase/create_incident_follow_ups.sql.",
    }, { status: 503 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
