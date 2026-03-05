import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

const getDomain = (email: string) => email.toLowerCase().split("@")[1] ?? ""

export async function POST(request: Request) {
  try {
    const sessionClient = await createSessionClient()
    const {
      data: { user: actorUser },
      error: actorError,
    } = await sessionClient.auth.getUser()

    if (actorError || !actorUser?.email) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const { data: actorProfile, error: roleError } = await sessionClient
      .from("users")
      .select("role_level")
      .eq("email", actorUser.email)
      .limit(1)
      .maybeSingle()

    if (roleError) {
      return NextResponse.json({ error: "No se pudo validar permisos." }, { status: 500 })
    }

    if (Number(actorProfile?.role_level ?? 1) < 4) {
      return NextResponse.json({ error: "Solo nivel 4 puede crear usuarios." }, { status: 403 })
    }

    const body = (await request.json()) as {
      name?: string
      email?: string
      role_level?: number
      status?: string
      assigned?: string
      temporaryPassword?: string
    }

    const name = (body.name ?? "").trim()
    const email = (body.email ?? "").trim().toLowerCase()
    const roleLevel = Number(body.role_level ?? 1)
    const status = (body.status ?? "Activo").trim() || "Activo"
    const assigned = (body.assigned ?? "").trim()
    const temporaryPassword = (body.temporaryPassword ?? "").trim()

    if (!name || !email || !temporaryPassword) {
      return NextResponse.json({ error: "Nombre, correo y clave temporal son obligatorios." }, { status: 400 })
    }

    if (temporaryPassword.length < 8) {
      return NextResponse.json({ error: "La clave temporal debe tener al menos 8 caracteres." }, { status: 400 })
    }

    const domain = getDomain(email)
    if (!ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      return NextResponse.json({ error: "Dominio de correo no permitido." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 500 })
    }

    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error: createAuthError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: { first_name: name },
    })

    if (createAuthError && !createAuthError.message.toLowerCase().includes("already")) {
      return NextResponse.json({ error: createAuthError.message }, { status: 400 })
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
