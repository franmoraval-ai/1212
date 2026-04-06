import { NextResponse } from "next/server"
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
    }

    const name = (body.name ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const roleLevel = Number(body.role_level ?? 1)
    const status = (body.status ?? "Activo").trim() || "Activo"
    const assigned = (body.assigned ?? "").trim()
    const temporaryPassword = (body.temporaryPassword ?? "").trim()
    const customPermissions = normalizePermissions(body.customPermissions)
    const shiftPin = String(body.shiftPin ?? "").replace(/\D/g, "")
    const shiftNfcCode = normalizeShiftNfcCode(body.shiftNfcCode)

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

    const { data: existingProfile } = await selectUserByNormalizedEmail<{ id?: string }>(
      admin,
      "id",
      email
    )

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
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando usuario." }, { status: 500 })
  }
}
