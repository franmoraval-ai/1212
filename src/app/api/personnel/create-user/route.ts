import { NextResponse } from "next/server"
import { writeAuditEvent } from "@/lib/audit-log"
import { validateL1Assignment } from "@/lib/personnel-assignment"
import { mapPasswordProviderError, validateStrongPassword } from "@/lib/password-policy"
import { normalizePermissions } from "@/lib/access-control"
import { getAssignableRoleLimit, getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"
import { ensureUniqueShiftNfcCode, hashShiftPin, normalizeShiftNfcCode } from "@/lib/shift-credentials"
import { selectUserByNormalizedEmail } from "@/lib/users-email"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

const getDomain = (email: string) => email.toLowerCase().split("@")[1] ?? ""

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status: authStatus } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status: authStatus })
    }

    const actorCanCreateUsers =
      isDirector(actor) ||
      hasCustomPermission(actor, "personnel_create")

    if (!actorCanCreateUsers) {
      return NextResponse.json({ error: "Solo nivel 4 puede crear usuarios." }, { status: 403 })
    }

    const body = (await request.json()) as {
      name?: string
      email?: string
      role_level?: number
      status?: string
      assigned?: string
      temporaryPassword?: string
      customPermissions?: string[]
      shiftPin?: string
      shiftNfcCode?: string
      personnelRegistryId?: string
    }

    let name = (body.name ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const roleLevel = Number(body.role_level ?? 1)
    const status = (body.status ?? "Activo").trim() || "Activo"
    const assigned = (body.assigned ?? "").trim()
    const temporaryPassword = (body.temporaryPassword ?? "").trim()
    const customPermissions = normalizePermissions(body.customPermissions)
    const shiftPin = String(body.shiftPin ?? "").replace(/\D/g, "")
    const shiftNfcCode = normalizeShiftNfcCode(body.shiftNfcCode)
    const personnelRegistryId = String(body.personnelRegistryId ?? "").trim()
    let registryPersonnelCode = ""

    if (personnelRegistryId) {
      if (roleLevel !== 1) {
        return NextResponse.json({ error: "Un prerregistro solo puede completarse como oficial L1." }, { status: 400 })
      }

      const { data: registryOfficer, error: registryError } = await admin
        .from("personnel_registry")
        .select("id,personnel_code,linked_user_id,full_name,status,source")
        .eq("id", personnelRegistryId)
        .maybeSingle()

      if (registryError) {
        return NextResponse.json({ error: "No se pudo validar el prerregistro seleccionado." }, { status: 500 })
      }
      if (!registryOfficer || String(registryOfficer.status ?? "").toUpperCase() !== "ACTIVO") {
        return NextResponse.json({ error: "El prerregistro seleccionado no existe o está inactivo." }, { status: 404 })
      }
      if (registryOfficer.linked_user_id) {
        return NextResponse.json({ error: "Este oficial ya tiene una cuenta de acceso vinculada." }, { status: 409 })
      }

      registryPersonnelCode = String(registryOfficer.personnel_code ?? "").trim()
      name = String(registryOfficer.full_name ?? "").trim()
      if (!registryPersonnelCode || !name) {
        return NextResponse.json({ error: "El prerregistro no tiene una identidad canónica válida." }, { status: 409 })
      }
    }

    if (!name || !email || !temporaryPassword) {
      return NextResponse.json({ error: "Nombre, correo y clave temporal son obligatorios." }, { status: 400 })
    }

    if (!Number.isInteger(roleLevel) || roleLevel < 1 || roleLevel > 4) {
      return NextResponse.json({ error: "role_level debe estar entre 1 y 4." }, { status: 400 })
    }

    const validation = validateStrongPassword(temporaryPassword)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const maxAssignableRole = getAssignableRoleLimit(actor)
    if (roleLevel > maxAssignableRole) {
      return NextResponse.json({ error: `Su perfil solo puede asignar hasta nivel ${maxAssignableRole}.` }, { status: 403 })
    }

    if (customPermissions.length > 0 && !isDirector(actor)) {
      return NextResponse.json({ error: "Solo nivel 4 puede asignar permisos personalizados." }, { status: 403 })
    }

    if (shiftPin && (shiftPin.length < 4 || shiftPin.length > 8)) {
      return NextResponse.json({ error: "El PIN de relevo debe tener entre 4 y 8 dígitos." }, { status: 400 })
    }

    if (roleLevel === 1) {
      const assignmentValidation = await validateL1Assignment(admin, assigned)
      if (!assignmentValidation.ok) {
        return NextResponse.json({ error: assignmentValidation.error }, { status: assignmentValidation.status })
      }
    }

    const domain = getDomain(email)
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: "Dominio de correo no permitido." }, { status: 400 })
    }

    const nfcValidation = await ensureUniqueShiftNfcCode(admin, shiftNfcCode)
    if (!nfcValidation.ok) {
      return NextResponse.json({ error: nfcValidation.error }, { status: nfcValidation.status })
    }

    const { data: createAuthData, error: createAuthError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { first_name: name },
    })

    if (createAuthError) {
      const authMessage = String(createAuthError.message ?? "")
      if (authMessage.toLowerCase().includes("already")) {
        return NextResponse.json(
          {
            error: "Ese correo ya existe en autenticación. Use recuperación de clave táctica o cambie el correo.",
          },
          { status: 409 }
        )
      }

      return NextResponse.json({ error: mapPasswordProviderError(authMessage) }, { status: 400 })
    }

    const authUserId = String(createAuthData.user?.id ?? "").trim()
    if (!authUserId) {
      return NextResponse.json({ error: "No se pudo recuperar el ID del usuario recién creado." }, { status: 500 })
    }

    const rollbackPreregistration = async () => {
      if (personnelRegistryId) {
        await admin
          .from("personnel_registry")
          .update({ linked_user_id: null, source: "PREREGISTRO", updated_at: new Date().toISOString() })
          .eq("id", personnelRegistryId)
      }
      await admin.from("users").delete().eq("id", authUserId)
      await admin.auth.admin.deleteUser(authUserId)
    }

    const { data: existingProfile } = await selectUserByNormalizedEmail<{ id?: string }>(
      admin,
      "id",
      email
    )

    const profileAction = existingProfile ? "reconciled" : "created"
    if (existingProfile) {
      const existingUserId = String(existingProfile.id ?? "").trim()
      if (existingUserId !== authUserId) {
        await admin.auth.admin.deleteUser(authUserId)
        return NextResponse.json({ error: "Ya existe un perfil local con ese correo y un ID distinto. Requiere conciliación manual antes de recrear el usuario." }, { status: 409 })
      }

      const { error: updateError } = await admin
        .from("users")
        .update({
          first_name: name,
          role_level: roleLevel,
          status,
          assigned,
          email,
          custom_permissions: customPermissions,
          shift_pin_hash: shiftPin ? hashShiftPin(shiftPin) : null,
          shift_nfc_code: shiftNfcCode || null,
        })
        .eq("id", authUserId)

      if (updateError) {
        await admin.auth.admin.deleteUser(authUserId)
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    } else {
      const { error: insertError } = await admin.from("users").insert({
        id: authUserId,
        ...(registryPersonnelCode ? { personnel_code: registryPersonnelCode } : {}),
        first_name: name,
        email,
        role_level: roleLevel,
        status,
        assigned,
        custom_permissions: customPermissions,
        shift_pin_hash: shiftPin ? hashShiftPin(shiftPin) : null,
        shift_nfc_code: shiftNfcCode || null,
        created_at: new Date().toISOString(),
      })

      if (insertError) {
        await admin.auth.admin.deleteUser(authUserId)
        const message = String(insertError.message ?? "")
        if (personnelRegistryId && message.toLowerCase().includes("personnel")) {
          return NextResponse.json({ error: "No se pudo vincular el prerregistro. Aplique la actualización del registro operacional e intente nuevamente." }, { status: 503 })
        }
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    if (personnelRegistryId) {
      const { data: linkedRegistry, error: linkedRegistryError } = await admin
        .from("personnel_registry")
        .select("linked_user_id")
        .eq("id", personnelRegistryId)
        .maybeSingle()

      if (linkedRegistryError || String(linkedRegistry?.linked_user_id ?? "") !== authUserId) {
        await rollbackPreregistration()
        return NextResponse.json({ error: "La cuenta no pudo vincularse al prerregistro; no se guardó el usuario." }, { status: 500 })
      }

      const { data: registryAssignments, error: registryAssignmentsError } = await admin
        .from("personnel_registry_assignments")
        .select("operation_catalog_id")
        .eq("personnel_registry_id", personnelRegistryId)
        .eq("is_active", true)

      if (registryAssignmentsError) {
        await rollbackPreregistration()
        return NextResponse.json({ error: "No se pudieron trasladar los puestos del prerregistro; no se guardó el usuario." }, { status: 500 })
      }

      const authorizationRows = ((registryAssignments ?? []) as Array<{ operation_catalog_id?: string | null }>)
        .map((assignment) => String(assignment.operation_catalog_id ?? "").trim())
        .filter(Boolean)
        .map((operationCatalogId) => ({
          operation_catalog_id: operationCatalogId,
          officer_user_id: authUserId,
          granted_by_user_id: actor.userId,
          is_active: true,
          valid_from: new Date().toISOString(),
          valid_to: null,
          notes: "Transferido al completar prerregistro operacional",
        }))

      if (authorizationRows.length > 0) {
        const { error: authorizationError } = await admin
          .from("station_officer_authorizations")
          .upsert(authorizationRows, { onConflict: "operation_catalog_id,officer_user_id" })

        if (authorizationError) {
          await rollbackPreregistration()
          return NextResponse.json({ error: "No se pudieron habilitar los puestos del oficial; no se guardó el usuario." }, { status: 500 })
        }
      }
    }

    await writeAuditEvent(admin, actor, {
      action: "personnel.user.created",
      resourceType: "user",
      resourceId: authUserId,
      metadata: {
        profileAction,
        targetEmail: email,
        roleLevel,
        status,
        assigned: assigned || null,
        customPermissions,
        hasShiftCredentials: Boolean(shiftPin || shiftNfcCode),
        personnelRegistryId: personnelRegistryId || null,
      },
    }, request)

    return NextResponse.json({ ok: true, personnelRegistryId: personnelRegistryId || null, personnelCode: registryPersonnelCode || null })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando usuario." }, { status: 500 })
  }
}
