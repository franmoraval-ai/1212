import { NextResponse } from "next/server"
import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { canViewSupervisionRecord, loadActorSupervisionScopes } from "@/lib/supervision-visibility"

const FINDING_SELECT = [
  "id",
  "supervision_id",
  "checklist_key",
  "category",
  "description",
  "severity",
  "corrected_onsite",
  "follow_up_required",
  "responsible_user_id",
  "corrective_action",
  "due_at",
  "status",
  "created_by_user_id",
  "verified_by_user_id",
  "verified_at",
  "created_at",
  "updated_at",
  "supervision:supervision_id(id,operation_name,review_post,officer_name,supervisor_id,event_occurred_at,created_at)",
].join(",")

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getSupervision(row: Record<string, unknown>) {
  const relation = Array.isArray(row.supervision) ? row.supervision[0] : row.supervision
  return isObjectRecord(relation) ? relation : null
}

function canManageFinding(actor: { uid: string; email: string; roleLevel: number }, supervision: Record<string, unknown>) {
  if (Number(actor.roleLevel ?? 0) >= 3) return true
  const owner = normalizeText(supervision.supervisor_id).toLowerCase()
  return Boolean(owner) && [actor.uid, actor.email].map((value) => normalizeText(value).toLowerCase()).includes(owner)
}

async function loadFindingContext(admin: { from: (table: string) => any }, findingId: string) {
  const { data, error } = await admin
    .from("supervision_findings")
    .select("id,supervision_id,supervision:supervision_id(id,operation_name,review_post,officer_name,supervisor_id,event_occurred_at,created_at)")
    .eq("id", findingId)
    .maybeSingle()

  const finding = isObjectRecord(data) ? data : null
  return { finding, supervision: finding ? getSupervision(finding) : null, error }
}

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }
  if (Number(actor.roleLevel ?? 0) < 2) {
    return NextResponse.json({ error: "Solo L2-L4 puede consultar hallazgos." }, { status: 403 })
  }

  const actorScopes = isDirector(actor)
    ? []
    : await loadActorSupervisionScopes(admin, { userId: actor.userId, assigned: actor.assigned })
  const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
  if (managedTeamError) {
    return NextResponse.json({ error: managedTeamError }, { status: 500 })
  }

  const { data, error: findingsError } = await admin
    .from("supervision_findings")
    .select(FINDING_SELECT)
    .order("created_at", { ascending: false })
    .limit(1000)

  if (findingsError) {
    return NextResponse.json({ error: "No se pudieron cargar los hallazgos." }, { status: 500 })
  }

  const findingRows = (Array.isArray(data) ? data : []) as unknown[]
  const findings = findingRows
    .filter(isObjectRecord)
    .flatMap((finding) => {
      const supervision = getSupervision(finding)
      if (!supervision) return []
      if (!isDirector(actor) && !canViewSupervisionRecord(actor, managedTeamScope, supervision, actorScopes)) return []
      return [{ ...finding, supervision, canManage: canManageFinding(actor, supervision) }]
    })

  return NextResponse.json({ ok: true, findings })
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }
  if (Number(actor.roleLevel ?? 0) < 2) {
    return NextResponse.json({ error: "Solo L2-L4 puede actualizar hallazgos." }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const findingId = normalizeText(body.finding_id)
  if (!findingId) {
    return NextResponse.json({ error: "Falta el hallazgo." }, { status: 400 })
  }

  const context = await loadFindingContext(admin, findingId)
  if (context.error) {
    return NextResponse.json({ error: "No se pudo validar el hallazgo." }, { status: 500 })
  }
  if (!context.finding || !context.supervision) {
    return NextResponse.json({ error: "Hallazgo no encontrado." }, { status: 404 })
  }

  const actorScopes = isDirector(actor)
    ? []
    : await loadActorSupervisionScopes(admin, { userId: actor.userId, assigned: actor.assigned })
  const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
  if (managedTeamError) {
    return NextResponse.json({ error: managedTeamError }, { status: 500 })
  }
  if (!isDirector(actor) && !canViewSupervisionRecord(actor, managedTeamScope, context.supervision, actorScopes)) {
    return NextResponse.json({ error: "El hallazgo está fuera de su dominio autorizado." }, { status: 403 })
  }
  if (!canManageFinding(actor, context.supervision)) {
    return NextResponse.json({ error: "Sin permiso para actualizar este hallazgo." }, { status: 403 })
  }

  const nextStatus = normalizeText(body.status).toUpperCase()
  const allowedStatuses = new Set(["ABIERTO", "EN_EJECUCION", "PENDIENTE_VERIFICACION", "CERRADO"])
  if (!allowedStatuses.has(nextStatus)) {
    return NextResponse.json({ error: "Estado de hallazgo no valido." }, { status: 400 })
  }
  const correctiveAction = normalizeText(body.corrective_action)
  if (nextStatus === "CERRADO" && !correctiveAction) {
    return NextResponse.json({ error: "Para cerrar el hallazgo debe indicar la accion correctiva." }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { error: updateError } = await admin
    .from("supervision_findings")
    .update({
      status: nextStatus,
      corrective_action: correctiveAction || null,
      updated_at: now,
      verified_by_user_id: nextStatus === "CERRADO" ? actor.userId : null,
      verified_at: nextStatus === "CERRADO" ? now : null,
    })
    .eq("id", findingId)

  if (updateError) {
    return NextResponse.json({ error: "No se pudo actualizar el hallazgo." }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}