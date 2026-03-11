import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"
import { mapPasswordProviderError, validateStrongPassword } from "@/lib/password-policy"
import { hasPermission, normalizePermissions } from "@/lib/access-control"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]
const PRIMARY_L4_EMAIL = "francisco@hoseguridad.com"

const getDomain = (email: string) => email.toLowerCase().split("@")[1] ?? ""

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEY en el servidor." }, { status: 500 })
    }

    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    let actorUser: { email?: string | null } | null = null

    const authHeader = request.headers.get("authorization")
    const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : ""

    if (bearerToken) {
      if (anonKey) {
        const tokenClient = createAdminClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        })
        const {
          data: { user },
          error,
        } = await tokenClient.auth.getUser()

        if (!error && user?.email) actorUser = { email: user.email }
      }

      if (!actorUser?.email) {
      const {
        data: { user },
        error,
      } = await admin.auth.getUser(bearerToken)

      if (!error && user?.email) actorUser = { email: user.email }
      }
    }

    if (!actorUser?.email) {
      const sessionClient = await createSessionClient()
      const {
        data: { user: cookieUser },
        error: cookieError,
      } = await sessionClient.auth.getUser()
      if (!cookieError && cookieUser?.email) actorUser = { email: cookieUser.email }
    }

    if (!actorUser?.email) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const { data: actorProfile, error: roleError } = await admin
      .from("users")
      .select("role_level, custom_permissions")
      .eq("email", actorUser.email)
      .limit(1)
      .maybeSingle()

    if (roleError) {
      return NextResponse.json({ error: "No se pudo validar permisos." }, { status: 500 })
    }

    const actorCanCreateUsers =
      Number(actorProfile?.role_level ?? 1) >= 4 ||
      hasPermission(actorProfile?.custom_permissions, "personnel_create")

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
    }

    const name = (body.name ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const roleLevel = Number(body.role_level ?? 1)
    const status = (body.status ?? "Activo").trim() || "Activo"
    const assigned = (body.assigned ?? "").trim()
    const temporaryPassword = (body.temporaryPassword ?? "").trim()
    const customPermissions = normalizePermissions(body.customPermissions)

    if (!name || !email || !temporaryPassword) {
      return NextResponse.json({ error: "Nombre, correo y clave temporal son obligatorios." }, { status: 400 })
    }

    const validation = validateStrongPassword(temporaryPassword)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const actorEmail = actorUser.email.trim().toLowerCase()
    if (roleLevel === 4 && actorEmail !== PRIMARY_L4_EMAIL) {
      return NextResponse.json({ error: "Solo Francisco puede asignar nivel 4." }, { status: 403 })
    }

    const domain = getDomain(email)
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: "Dominio de correo no permitido." }, { status: 400 })
    }

    const { error: createAuthError } = await admin.auth.admin.createUser({
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

    const { data: existing } = await admin
      .from("users")
      .select("id")
      .ilike("email", email)
      .limit(1)

    if (existing && existing.length > 0) {
      const { error: updateError } = await admin
        .from("users")
        .update({
          first_name: name,
          role_level: roleLevel,
          status,
          assigned,
          email,
          custom_permissions: customPermissions,
        })
        .eq("id", existing[0].id)

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }
    } else {
      const { error: insertError } = await admin.from("users").insert({
        first_name: name,
        email,
        role_level: roleLevel,
        status,
        assigned,
        custom_permissions: customPermissions,
        created_at: new Date().toISOString(),
      })

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando usuario." }, { status: 500 })
  }
}
