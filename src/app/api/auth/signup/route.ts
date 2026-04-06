import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { isAuthTimeoutError, withAuthTimeout } from "@/lib/auth-route-timeout"
import { getAdminClient } from "@/lib/server-auth"
import { mapPasswordProviderError, validateStrongPassword } from "@/lib/password-policy"
import { selectUserByNormalizedEmail } from "@/lib/users-email"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

function getDomain(email: string) {
  return email.toLowerCase().split("@")[1] ?? ""
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      fullName?: string
      email?: string
      password?: string
    }

    const fullName = String(body.fullName ?? "").trim()
    const email = String(body.email ?? "").trim().toLowerCase()
    const password = String(body.password ?? "")

    if (!fullName || !email || !password) {
      return NextResponse.json({ error: "Nombre, correo y clave son obligatorios." }, { status: 400 })
    }

    if (!ALLOWED_EMAIL_DOMAINS.includes(getDomain(email))) {
      return NextResponse.json({ error: "Dominio de correo no permitido." }, { status: 400 })
    }

    const validation = validateStrongPassword(password)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Falta configurar Supabase en el servidor." }, { status: 500 })
    }

    const signupClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data, error } = await withAuthTimeout(
      signupClient.auth.signUp({
        email,
        password,
        options: {
          data: { first_name: fullName },
        },
      }),
      "El alta de usuario tardó demasiado en responder."
    )

    if (error) {
      return NextResponse.json({ error: mapPasswordProviderError(error.message) }, { status: 400 })
    }

    const authUserId = String(data.user?.id ?? "").trim()
    const authUserEmail = String(data.user?.email ?? email).trim().toLowerCase()
    if (!authUserId || !authUserEmail) {
      return NextResponse.json({ error: "No se pudo confirmar el usuario creado." }, { status: 500 })
    }

    const { admin, error: adminError } = getAdminClient()
    if (!admin) {
      return NextResponse.json({ error: adminError ?? "No se pudo acceder al registro de usuarios." }, { status: 500 })
    }

    const { data: existingProfile } = await selectUserByNormalizedEmail<{ id?: string }>(
      admin,
      "id",
      authUserEmail
    )

    const existingUserId = String(existingProfile?.id ?? "").trim()
    if (existingUserId && existingUserId !== authUserId) {
      await admin.auth.admin.deleteUser(authUserId)
      return NextResponse.json({ error: "Ya existe un perfil operativo con ese correo. Solicite soporte para conciliación manual." }, { status: 409 })
    }

    const profilePayload = {
      id: authUserId,
      email: authUserEmail,
      first_name: fullName,
      role_level: 1,
      status: "Activo",
      assigned: "",
      created_at: new Date().toISOString(),
    }

    const { error: profileError } = existingUserId
      ? await admin.from("users").update(profilePayload).eq("id", authUserId)
      : await admin.from("users").insert(profilePayload)

    if (profileError) {
      await admin.auth.admin.deleteUser(authUserId)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAuthTimeoutError(error)) {
      return NextResponse.json({ error: "El alta de usuario tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    return NextResponse.json({ error: "Error inesperado creando usuario." }, { status: 500 })
  }
}