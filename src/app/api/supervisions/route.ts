import { NextResponse } from "next/server"
import { loadManagedTeamScope, matchesActorOrManagedIdentity } from "@/lib/manager-hierarchy"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { isOfficerAuthorizedForStation } from "@/lib/station-officer-authorizations"
import { resolveStationReference } from "@/lib/stations"
import { canViewSupervisionRecord, loadActorSupervisionScopes } from "@/lib/supervision-visibility"
import {
  SUPERVISION_DETAIL_SELECT_EXTENDED,
  SUPERVISION_DETAIL_SELECT_STABLE,
  SUPERVISION_LIST_SUMMARY_SELECT,
  SUPERVISION_LIST_SUMMARY_SELECT_STABLE,
} from "@/lib/supervision-selects"

type SupervisionRow = {
  id: string
  supervisor_id?: string | null
  status?: string | null
  observations?: string | null
  operation_name?: string | null
  review_post?: string | null
  checklist?: Record<string, unknown> | null
  checklist_reasons?: Record<string, unknown> | null
  photos?: unknown[] | null
}

const SUPERVISION_COMPAT_COLUMNS = [
  "officer_phone",
  "evidence_bundle",
  "geo_risk",
  "operation_catalog_id",
  "event_occurred_at",
  "recorded_by_user_id",
  "checklist_version",
  "finding_required",
  "corrected_onsite",
  "follow_up_required",
  "device_context",
] as const
const SUPERVISION_STATUSES = new Set(["CUMPLIM", "CON NOVEDAD", "REVISIÓN PROPIEDAD"])
const FINDING_SEVERITIES = new Set(["BAJA", "MEDIA", "ALTA", "CRITICA"])
const SUPERVISION_OWNER_PATCH_FIELDS = new Set(["status", "observations"])
const SUPERVISION_DIRECTOR_PATCH_FIELDS = new Set([
  "operation_name",
  "officer_name",
  "review_post",
  "status",
  "observations",
])
const CONTRADICTORY_NOVELTY_OBSERVATIONS = new Set([
  "sin novedad",
  "todo en orden",
  "todo bien",
  "sin observaciones",
  "ninguna",
  "n/a",
  "na",
])

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeObservation(value: unknown) {
  return normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function validateSupervisionStatusAndObservations(
  row: Record<string, unknown>,
  validateStatus: boolean,
  requireNoveltyEvidence: boolean
) {
  const status = normalizeText(row.status)

  if (validateStatus && (!status || !SUPERVISION_STATUSES.has(status))) {
    return "Estado de supervision no valido."
  }

  if (status !== "CON NOVEDAD") return null

  const observation = normalizeObservation(row.observations)
  if (!observation || CONTRADICTORY_NOVELTY_OBSERVATIONS.has(observation)) {
    return "CON NOVEDAD requiere una observacion que describa el hallazgo."
  }

  if (!requireNoveltyEvidence) return null

  if (!Array.isArray(row.photos) || row.photos.length === 0) {
    return "CON NOVEDAD requiere al menos una evidencia fotografica."
  }

  const checklist = isObjectRecord(row.checklist) ? row.checklist : {}
  const checklistReasons = isObjectRecord(row.checklist_reasons) ? row.checklist_reasons : {}
  const hasUnjustifiedFinding = Object.entries(checklist).some(([key, value]) => (
    (value === false || normalizeText(value).toUpperCase() === "NO_CONFORME") && !normalizeText(checklistReasons[key])
  ))

  if (hasUnjustifiedFinding) {
    return "CON NOVEDAD requiere justificar cada estándar no cumplido."
  }

  return null
}

function buildFindingRows(rawFindings: unknown, supervisionId: string, actorUserId: string) {
  if (rawFindings === undefined) return { rows: [] as Record<string, unknown>[], error: null }
  if (!Array.isArray(rawFindings) || rawFindings.length > 20) {
    return { rows: [], error: "Los hallazgos de supervision no son validos." }
  }

  const rows: Record<string, unknown>[] = []
  for (const rawFinding of rawFindings) {
    if (!isObjectRecord(rawFinding)) {
      return { rows: [], error: "Los hallazgos de supervision no son validos." }
    }

    const checklistKey = normalizeText(rawFinding.checklist_key ?? rawFinding.checklistKey)
    const category = normalizeText(rawFinding.category) || checklistKey
    const description = normalizeText(rawFinding.description)
    const severity = normalizeText(rawFinding.severity).toUpperCase()
    if (!checklistKey || checklistKey.length > 100 || !category || category.length > 100 || !description || description.length > 4000 || !FINDING_SEVERITIES.has(severity)) {
      return { rows: [], error: "Cada hallazgo requiere item, descripcion y severidad validos." }
    }

    rows.push({
      supervision_id: supervisionId,
      checklist_key: checklistKey,
      category,
      description,
      severity,
      corrected_onsite: rawFinding.corrected_onsite === true || rawFinding.correctedOnsite === true,
      follow_up_required: rawFinding.follow_up_required === true || rawFinding.followUpRequired === true,
      created_by_user_id: actorUserId,
    })
  }

  return { rows, error: null }
}

async function validateActiveOperationPost(admin: { from: (table: string) => any }, row: Record<string, unknown>) {
  const operationName = normalizeText(row.operation_name).toUpperCase()
  const reviewPost = normalizeText(row.review_post).toUpperCase()
  if (!operationName || !reviewPost) return { valid: false, error: null, operationCatalogId: null }

  const { data, error } = await admin
    .from("operation_catalog")
    .select("id,operation_name,client_name")
    .eq("is_active", true)

  if (error) {
    return { valid: false, error: String(error.message ?? "No se pudo validar el catálogo operativo."), operationCatalogId: null }
  }

  const catalogMatch = Array.isArray(data) && data.find((item) => isObjectRecord(item) && (
    normalizeText(item.operation_name).toUpperCase() === operationName &&
    normalizeText(item.client_name).toUpperCase() === reviewPost
  ))

  const operationCatalogId = isObjectRecord(catalogMatch) ? normalizeText(catalogMatch.id) : ""
  return { valid: Boolean(operationCatalogId), error: null, operationCatalogId: operationCatalogId || null }
}

async function validateOfficerIdentity(admin: { from: (table: string) => any }, row: Record<string, unknown>) {
  const officerRegistryId = normalizeText(row.officer_registry_id)
  const officerUserId = normalizeText(row.officer_user_id)

  if (officerRegistryId) {
    const { data: registryOfficer, error: registryError } = await admin
      .from("personnel_registry")
      .select("id,linked_user_id,full_name,id_number,phone,status")
      .eq("id", officerRegistryId)
      .maybeSingle()

    if (registryError) {
      return { valid: false, error: String(registryError.message ?? "No se pudo validar el registro del oficial."), officerName: "" }
    }

    const profile = isObjectRecord(registryOfficer) ? registryOfficer : null
    const profileStatus = normalizeText(profile?.status).toUpperCase()
    const profileName = normalizeText(profile?.full_name)
    const linkedUserId = normalizeText(profile?.linked_user_id)
    if (!profile || profileStatus !== "ACTIVO" || !profileName) {
      return { valid: false, error: "El oficial seleccionado no existe o no está activo.", officerName: "" }
    }

    if (linkedUserId) {
      const assignedScope = `${normalizeText(row.operation_name)} | ${normalizeText(row.review_post)}`
      const authorization = await isOfficerAuthorizedForStation(
        admin as never,
        linkedUserId,
        resolveStationReference({ assigned: assignedScope, stationLabel: normalizeText(row.review_post) })
      )
      if (!authorization.ok) {
        return { valid: false, error: authorization.error ?? "No se pudo validar la autorización del oficial.", officerName: "" }
      }
      if (!authorization.isAuthorized) {
        return { valid: false, error: "El oficial seleccionado no está autorizado para este puesto.", officerName: "" }
      }
    } else {
      const { data: assignment, error: assignmentError } = await admin
        .from("personnel_registry_assignments")
        .select("id")
        .eq("personnel_registry_id", officerRegistryId)
        .eq("operation_catalog_id", normalizeText(row.operation_catalog_id))
        .eq("is_active", true)
        .maybeSingle()

      if (assignmentError) {
        return { valid: false, error: String(assignmentError.message ?? "No se pudo validar el puesto del oficial prerregistrado."), officerName: "" }
      }
      if (!assignment?.id) {
        return { valid: false, error: "El oficial prerregistrado no está asociado con este puesto.", officerName: "" }
      }
    }

    const idNumber = normalizeText(profile.id_number) || normalizeText(row.id_number)
    if (!idNumber) {
      return { valid: false, error: "El oficial seleccionado no tiene cédula o ID registrado.", officerName: "" }
    }

    return {
      valid: true,
      error: null,
      officerName: profileName,
      officerUserId: linkedUserId || null,
      idNumber,
      phone: normalizeText(profile.phone) || normalizeText(row.officer_phone) || null,
    }
  }

  if (!officerUserId) {
    return { valid: false, error: "Seleccione un oficial registrado o prerregistrado.", officerName: "" }
  }

  const { data: officer, error } = await admin
    .from("users")
    .select("id,first_name,role_level,status")
    .eq("id", officerUserId)
    .maybeSingle()

  if (error) {
    return { valid: false, error: String(error.message ?? "No se pudo validar la identidad del oficial."), officerName: "" }
  }

  const officerRow = isObjectRecord(officer) ? officer : null
  const officerStatus = normalizeText(officerRow?.status).toLowerCase()
  const officerName = normalizeText(officerRow?.first_name)
  const isActive = ["", "active", "activo"].includes(officerStatus)
  if (!officerRow || Number(officerRow.role_level ?? 1) !== 1 || !isActive || !officerName) {
    return { valid: false, error: "El oficial seleccionado no existe o no está activo.", officerName: "" }
  }

  const assignedScope = `${normalizeText(row.operation_name)} | ${normalizeText(row.review_post)}`
  const authorization = await isOfficerAuthorizedForStation(
    admin as never,
    officerUserId,
    resolveStationReference({ assigned: assignedScope, stationLabel: normalizeText(row.review_post) })
  )
  if (!authorization.ok) {
    return { valid: false, error: authorization.error ?? "No se pudo validar la autorización del oficial.", officerName: "" }
  }
  if (!authorization.isAuthorized) {
    return { valid: false, error: "El oficial seleccionado no está autorizado para este puesto.", officerName: "" }
  }

  return {
    valid: true,
    error: null,
    officerName,
    officerUserId,
    idNumber: normalizeText(row.id_number),
    phone: normalizeText(row.officer_phone) || null,
  }
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

function canManageSupervision(actor: { uid: string; userId: string; email: string; roleLevel: number }, row: SupervisionRow) {
  if (Number(actor.roleLevel ?? 0) >= 4) return true

  const actorUid = normalizeText(actor.uid).toLowerCase()
  const actorUserId = normalizeText(actor.userId).toLowerCase()
  const actorEmail = normalizeText(actor.email).toLowerCase()
  const supervisorId = normalizeText(row.supervisor_id).toLowerCase()

  if (!supervisorId) return false
  return supervisorId === actorUid || supervisorId === actorUserId || supervisorId === actorEmail
}

function getAllowedSupervisionPatchFields(roleLevel: number) {
  return roleLevel >= 4 ? SUPERVISION_DIRECTOR_PATCH_FIELDS : SUPERVISION_OWNER_PATCH_FIELDS
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

async function readSupervisionById(admin: { from: (table: string) => any }, id: string) {
  const { data, error } = await admin
    .from("supervisions")
    .select("id,supervisor_id,status,observations,operation_name,review_post,checklist,checklist_reasons,photos")
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

  const actorScopes = isDirector(actor) ? [] : await loadActorSupervisionScopes(admin, actor)
  const { scope: managedTeamScope, error: managedTeamError } = await loadManagedTeamScope(admin, actor)
  if (managedTeamError) {
    return NextResponse.json({ error: managedTeamError }, { status: 500 })
  }

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

    if (!isDirector(actor) && isObjectRecord(data) && !canViewSupervisionRecord(actor, managedTeamScope, data, actorScopes)) {
      return NextResponse.json({ error: "La supervision está fuera de su dominio autorizado." }, { status: 403 })
    }

    const { data: findings, error: findingsError } = await admin
      .from("supervision_findings")
      .select("id,supervision_id,checklist_key,category,description,severity,corrected_onsite,follow_up_required,responsible_user_id,corrective_action,due_at,status,created_by_user_id,verified_by_user_id,verified_at,created_at,updated_at")
      .eq("supervision_id", id)
      .order("created_at", { ascending: false })

    if (findingsError) {
      return NextResponse.json({ error: "No se pudieron cargar los hallazgos de la supervision." }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      record: data ?? null,
      findings: findings ?? [],
      canManage: isObjectRecord(data) && normalizeText(data.id)
        ? canManageSupervision(actor, {
          id: normalizeText(data.id),
          supervisor_id: normalizeText(data.supervisor_id),
        })
        : false,
    })
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
      : records.filter((row) => isObjectRecord(row) && canViewSupervisionRecord(actor, managedTeamScope, row, actorScopes))

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
    : records.filter((row) => isObjectRecord(row) && canViewSupervisionRecord(actor, managedTeamScope, row, actorScopes))

  return NextResponse.json({ ok: true, records: scopedRecords })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const rawFindings = body.findings
    const row: Record<string, unknown> = {
      ...body,
      supervisor_id: actor.userId,
      recorded_by_user_id: actor.userId,
      event_occurred_at: normalizeText(body.event_occurred_at) || new Date().toISOString(),
    }
    delete row.findings

    const supervisionId = normalizeText(row.id)
    const findingsResult = buildFindingRows(rawFindings, supervisionId, actor.userId)
    if (findingsResult.error) {
      return NextResponse.json({ error: findingsResult.error }, { status: 400 })
    }
    if (findingsResult.rows.length > 0 && !supervisionId) {
      return NextResponse.json({ error: "Supervision V2 requiere un identificador de envio." }, { status: 400 })
    }

    if (findingsResult.rows.length > 0) {
      row.checklist_version = 2
      row.finding_required = true
      row.corrected_onsite = findingsResult.rows.every((finding) => finding.corrected_onsite === true)
      row.follow_up_required = findingsResult.rows.some((finding) => finding.follow_up_required === true)
    }

    const isPropertyReview = normalizeText(row.type) === "Propiedad"
    if (!normalizeText(row.operation_name) || !normalizeText(row.review_post) || (!isPropertyReview && !normalizeText(row.id_number))) {
      return NextResponse.json({ error: "Operacion, cliente, oficial y cedula son obligatorios." }, { status: 400 })
    }

    const qualityError = validateSupervisionStatusAndObservations(
      row,
      Object.hasOwn(row, "status"),
      normalizeText(row.status) === "CON NOVEDAD"
    )
    if (qualityError) {
      return NextResponse.json({ error: qualityError }, { status: 400 })
    }

    const catalogValidation = await validateActiveOperationPost(admin, row)
    if (catalogValidation.error) {
      return NextResponse.json({ error: catalogValidation.error }, { status: 503 })
    }
    if (!catalogValidation.valid) {
      return NextResponse.json({ error: "La operación y el puesto deben estar activos en el catálogo operativo." }, { status: 400 })
    }
    row.operation_catalog_id = catalogValidation.operationCatalogId

    const hasOfficerSelected = Boolean(normalizeText(row.officer_registry_id) || normalizeText(row.officer_user_id))
    if (isPropertyReview && !hasOfficerSelected) {
      row.officer_name = ""
      row.officer_user_id = null
      row.officer_registry_id = null
    } else {
      const officerValidation = await validateOfficerIdentity(admin, row)
      if (!officerValidation.valid) {
        return NextResponse.json({ error: officerValidation.error }, { status: officerValidation.error?.includes("autorizado") ? 403 : 400 })
      }
      row.officer_name = officerValidation.officerName
      row.officer_user_id = officerValidation.officerUserId
      row.id_number = officerValidation.idNumber
      row.officer_phone = officerValidation.phone
    }

    let { error: insertError } = await admin.from("supervisions").insert(row)
    let warning: string | null = null

    if (insertError && hasCompatColumnError(insertError.message)) {
      const fallback = await admin.from("supervisions").insert(stripCompatColumns(row))
      insertError = fallback.error
      if (!insertError) {
        warning = "Su base de datos aun no tiene todas las columnas opcionales de supervision. Revise las migraciones pendientes."
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

    if (findingsResult.rows.length > 0) {
      const { error: findingsError } = await admin.from("supervision_findings").insert(findingsResult.rows)
      if (findingsError) {
        await admin.from("supervisions").delete().eq("id", supervisionId)
        return NextResponse.json({ error: "No se pudieron registrar los hallazgos de la supervision." }, { status: 500 })
      }
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
    const findingId = normalizeText(body.finding_id)
    if (findingId) {
      const { data: finding, error: findingReadError } = await admin
        .from("supervision_findings")
        .select("id,supervision_id,status")
        .eq("id", findingId)
        .maybeSingle()

      if (findingReadError) {
        return NextResponse.json({ error: "No se pudo validar el hallazgo." }, { status: 500 })
      }
      if (!isObjectRecord(finding)) {
        return NextResponse.json({ error: "Hallazgo no encontrado." }, { status: 404 })
      }

      const supervision = await readSupervisionById(admin, normalizeText(finding.supervision_id))
      if (supervision.error) {
        return NextResponse.json({ error: supervision.error }, { status: 500 })
      }
      if (!supervision.row || !canManageSupervision(actor, supervision.row)) {
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

      const findingPatch: Record<string, unknown> = {
        status: nextStatus,
        corrective_action: correctiveAction || null,
        updated_at: new Date().toISOString(),
        verified_by_user_id: nextStatus === "CERRADO" ? actor.userId : null,
        verified_at: nextStatus === "CERRADO" ? new Date().toISOString() : null,
      }
      const { error: findingUpdateError } = await admin
        .from("supervision_findings")
        .update(findingPatch)
        .eq("id", findingId)

      if (findingUpdateError) {
        return NextResponse.json({ error: "No se pudo actualizar el hallazgo." }, { status: 500 })
      }

      return NextResponse.json({ ok: true })
    }

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

    const allowedFields = getAllowedSupervisionPatchFields(Number(actor.roleLevel ?? 0))
    const unsupportedFields = Object.keys(payload).filter((field) => !allowedFields.has(field))
    if (unsupportedFields.length > 0) {
      return NextResponse.json({ error: "Campos no permitidos para actualizar esta supervision." }, { status: 400 })
    }

    const qualityError = validateSupervisionStatusAndObservations(
      { ...current.row, ...payload },
      Object.hasOwn(payload, "status"),
      normalizeText(payload.status) === "CON NOVEDAD"
    )
    if (qualityError) {
      return NextResponse.json({ error: qualityError }, { status: 400 })
    }

    if (Object.hasOwn(payload, "operation_name") || Object.hasOwn(payload, "review_post")) {
      const catalogValidation = await validateActiveOperationPost(admin, { ...current.row, ...payload })
      if (catalogValidation.error) {
        return NextResponse.json({ error: catalogValidation.error }, { status: 503 })
      }
      if (!catalogValidation.valid) {
        return NextResponse.json({ error: "La operación y el puesto deben estar activos en el catálogo operativo." }, { status: 400 })
      }
      payload.operation_catalog_id = catalogValidation.operationCatalogId
    }

    let { error: updateError } = await admin
      .from("supervisions")
      .update(payload)
      .eq("id", id)

    if (updateError && hasCompatColumnError(updateError.message)) {
      const fallback = await admin
        .from("supervisions")
        .update(stripCompatColumns(payload))
        .eq("id", id)
      updateError = fallback.error
    }

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
