import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { isAuthTimeoutError, withAuthTimeout } from "@/lib/auth-route-timeout"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

function getDomain(email: string) {
  return email.toLowerCase().split("@")[1] ?? ""
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string
      redirectTo?: string
    }

    const email = String(body.email ?? "").trim().toLowerCase()
    const redirectTo = String(body.redirectTo ?? "").trim() || undefined

    if (!email) {
      return NextResponse.json({ error: "Correo requerido." }, { status: 400 })
    }

    if (!ALLOWED_EMAIL_DOMAINS.includes(getDomain(email))) {
      return NextResponse.json({ error: "Dominio de correo no permitido." }, { status: 400 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Falta configurar Supabase en el servidor." }, { status: 500 })
    }

    const recoveryClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { error } = await withAuthTimeout(
      recoveryClient.auth.resetPasswordForEmail(email, { redirectTo }),
      "La recuperación de clave tardó demasiado en responder."
    )
    if (error) {
      return NextResponse.json({ error: error.message || "No se pudo enviar el correo de recuperación." }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAuthTimeoutError(error)) {
      return NextResponse.json({ error: "La recuperación de clave tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    return NextResponse.json({ error: "Error inesperado solicitando recuperación." }, { status: 500 })
  }
}