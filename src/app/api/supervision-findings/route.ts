import { NextResponse } from "next/server"
import { writeAuditEvent } from "@/lib/audit-log"
import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { canAlertOfficer } from "@/lib/push-authorization"
import { sendPushToUserIds } from "@/lib/push-server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { stationMatchesAssigned } from "@/lib/stations"
import { canViewSupervisionRecord, loadActorSupervisionScopes } from "@/lib/supervision-visibility"

type FindingAssigneeRow = {
  id?: unknown
  first_name?: unknown
  email?: unknown
  role_level?: unknown
  status?: unknown
  assigned?: unknown
}

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

function normalizeAssignee(row: FindingAssigneeRow) {
  const status = normalizeText(row.status).toLowerCase()
  return {
    id: normalizeText(row.id),
    email: normalizeText(row.email).toLowerCase(),
    roleLevel: Number(row.role_level ?? 1),
    assigned: normalizeText(row.assigned),
    label: normalizeText(row.first_name) || `Usuario ${normalizeText(row.id).slice(0, 8)}`,
    isActive: status === "activo" || status === "active",
  }
}

async function loadFindingUsers(admin: { from: (table: string) => any }) {
  const { data, error } = await admin
    .from("users")
    .select("id,first_name,email,role_level,status,assigned")
    .order("first_name", { ascending: true })
    .limit(1000)

  if (error) return { users: [], error: "No se pudo cargar la lista de responsables." }

  const users = ((Array.isArray(data) ? data : []) as FindingAssigneeRow[])
    .filter((row) => Boolean(normalizeText(row.id)))
    .map(normalizeAssignee)

  return { users, error: null }
}

function canAssignToSupervision(
  actor: { uid: string; userId: string; email: string; assigned: string | null; roleLevel: number },
  managedTeamScope: Awaited<ReturnType<typeof loadManagedTeamScope>>["scope"],
  candidate: ReturnType<typeof normalizeAssignee>,
  supervision: Record<string, unknown>
) {
  if (!candidate.isActive || candidate.roleLevel < 2 || candidate.roleLevel >= 4) return false
  const matchesFindingScope = stationMatchesAssigned(normalizeText(supervision.review_post), candidate.assigned)
    || stationMatchesAssigned(normalizeText(supervision.operation_name), candidate.assigned)
  if (!matchesFindingScope) return false
  if (Number(actor.roleLevel ?? 0) >= 4) return true
  if (Number(actor.roleLevel ?? 0) === 3) {
    return canAlertOfficer(actor, managedTeamScope, candidate)
  }
  return Number(actor.roleLevel ?? 0) === 2
}

function getFindingAssignees(
  actor: { uid: string; userId: string; email: string; assigned: string | null; roleLevel: number },
  managedTeamScope: Awaited<ReturnType<typeof loadManagedTeamScope>>["scope"],
  users: ReturnType<typeof normalizeAssignee>[],
  supervision: Record<string, unknown>
) {
  const scoped = users.filter((candidate) => canAssignToSupervision(actor, managedTeamScope, candidate, supervision))
  if (scoped.length > 0 || Number(actor.roleLevel ?? 0) < 4) return scoped

  return users.filter((candidate) => (
    candidate.isActive && candidate.roleLevel >= 2 && candidate.roleLevel < 4
  ))
}

function toAssigneeOption(candidate: ReturnType<typeof normalizeAssignee>) {
  return { id: candidate.id, label: candidate.label }
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
    .select("id,supervision_id,severity,responsible_user_id,corrective_action,due_at,status,verified_by_user_id,verified_at,supervision:supervision_id(id,operation_name,review_post,officer_name,supervisor_id,event_occurred_at,created_at)")
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

  const userResult = await loadFindingUsers(admin)
  if (userResult.error) {
    return NextResponse.json({ error: userResult.error }, { status: 500 })
  }
  const usersById = new Map(userResult.users.map((user) => [user.id, user]))

  const findingRows = (Array.isArray(data) ? data : []) as unknown[]
  const scopedFindings = findingRows
    .filter(isObjectRecord)
    .flatMap((finding) => {
      const supervision = getSupervision(finding)
      if (!supervision) return []
      if (!isDirector(actor) && !canViewSupervisionRecord(actor, managedTeamScope, supervision, actorScopes)) return []
      return [{ finding, supervision }]
    })
  const eligibleAssignees = new Map<string, ReturnType<typeof normalizeAssignee>>()
  const findings = scopedFindings
    .map(({ finding, supervision }) => {
      const findingAssignees = getFindingAssignees(actor, managedTeamScope, userResult.users, supervision)
      findingAssignees.forEach((candidate) => eligibleAssignees.set(candidate.id, candidate))
      const responsibleUserId = normalizeText(finding.responsible_user_id)
      const responsible = usersById.get(responsibleUserId)
      return [{
        ...finding,
        responsible: responsible
          ? toAssigneeOption(responsible)
          : responsibleUserId
            ? { id: responsibleUserId, label: "Usuario no disponible" }
            : null,
        eligibleAssigneeIds: findingAssignees.map((candidate) => candidate.id),
        isMine: [actor.userId, actor.uid].map((value) => normalizeText(value)).includes(responsibleUserId),
        supervision,
        canManage: canManageFinding(actor, supervision),
      }]
    }).flat()

  return NextResponse.json({
    ok: true,
    findings,
    assignees: Array.from(eligibleAssignees.values()).map(toAssigneeOption),
  })
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

  const nextStatus = normalizeText(Object.hasOwn(body, "status") ? body.status : context.finding.status).toUpperCase()
  const allowedStatuses = new Set(["ABIERTO", "EN_EJECUCION", "PENDIENTE_VERIFICACION", "CERRADO"])
  if (!allowedStatuses.has(nextStatus)) {
    return NextResponse.json({ error: "Estado de hallazgo no valido." }, { status: 400 })
  }
  const correctiveAction = normalizeText(Object.hasOwn(body, "corrective_action") ? body.corrective_action : context.finding.corrective_action)
  if (nextStatus === "CERRADO" && !correctiveAction) {
    return NextResponse.json({ error: "Para cerrar el hallazgo debe indicar la accion correctiva." }, { status: 400 })
  }

  const responsibleUserId = normalizeText(Object.hasOwn(body, "responsible_user_id")
    ? body.responsible_user_id
    : context.finding.responsible_user_id)
  if (responsibleUserId && responsibleUserId !== normalizeText(context.finding.responsible_user_id)) {
    const userResult = await loadFindingUsers(admin)
    if (userResult.error) {
      return NextResponse.json({ error: userResult.error }, { status: 500 })
    }
    const candidate = userResult.users.find((user) => user.id === responsibleUserId)
    const eligibleCandidates = getFindingAssignees(actor, managedTeamScope, userResult.users, context.supervision)
    if (!candidate || !eligibleCandidates.some((eligible) => eligible.id === candidate.id)) {
      return NextResponse.json({ error: "El responsable está fuera de su ámbito autorizado." }, { status: 400 })
    }
  }

  const rawDueAt = normalizeText(Object.hasOwn(body, "due_at") ? body.due_at : context.finding.due_at)
  const dueAt = rawDueAt ? new Date(rawDueAt) : null
  const isCanonicalIsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(rawDueAt)
    && dueAt?.toISOString() === rawDueAt
  if (rawDueAt && (!isCanonicalIsoTimestamp || !dueAt || Number.isNaN(dueAt.getTime()))) {
    return NextResponse.json({ error: "La fecha límite no es válida." }, { status: 400 })
  }
  const severity = normalizeText(Object.hasOwn(body, "severity") ? body.severity : context.finding.severity).toUpperCase()
  if (!new Set(["BAJA", "MEDIA", "ALTA", "CRITICA"]).has(severity)) {
    return NextResponse.json({ error: "La severidad no es válida." }, { status: 400 })
  }

  const now = new Date().toISOString()
  const previousStatus = normalizeText(context.finding.status).toUpperCase()
  const closesNow = previousStatus !== "CERRADO" && nextStatus === "CERRADO"
  const remainsClosed = previousStatus === "CERRADO" && nextStatus === "CERRADO"
  const update = {
    status: nextStatus,
    severity,
    responsible_user_id: responsibleUserId || null,
    due_at: dueAt?.toISOString() ?? null,
    corrective_action: correctiveAction || null,
    updated_at: now,
    verified_by_user_id: closesNow ? actor.userId : remainsClosed ? context.finding.verified_by_user_id ?? null : null,
    verified_at: closesNow ? now : remainsClosed ? context.finding.verified_at ?? null : null,
  }
  const { error: updateError } = await admin
    .from("supervision_findings")
    .update(update)
    .eq("id", findingId)

  if (updateError) {
    return NextResponse.json({ error: "No se pudo actualizar el hallazgo." }, { status: 500 })
  }
  const previousResponsibleUserId = normalizeText(context.finding.responsible_user_id)
  if (responsibleUserId && responsibleUserId !== previousResponsibleUserId) {
    await sendPushToUserIds(admin, [responsibleUserId], {
      title: "Nueva notificación",
      body: "Ingresa a la aplicación para revisar los detalles.",
      url: "/supervision-findings",
      tag: `supervision-finding-${findingId}`,
    })
  }
  await writeAuditEvent(admin, actor, {
    action: "supervision_finding.updated",
    resourceType: "supervision_finding",
    resourceId: findingId,
    metadata: {
      supervisionId: normalizeText(context.finding.supervision_id),
      status: nextStatus,
      severity,
      responsibleUserId: responsibleUserId || null,
      dueAt: dueAt?.toISOString() ?? null,
    },
  }, request)
  return NextResponse.json({ ok: true })
}