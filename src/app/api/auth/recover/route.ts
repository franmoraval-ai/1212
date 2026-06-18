import { NextResponse } from "next/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { isAuthTimeoutError, withAuthTimeout } from "@/lib/auth-route-timeout"
import { sanitizeRecoveryRedirect } from "@/lib/auth-redirect"
import { buildAuthRateLimitKey, consumeAuthRateLimit, readAuthRateLimitConfig } from "@/lib/auth-rate-limit"
import { logSecurityEvent } from "@/lib/security-telemetry"

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
    const redirectTo = sanitizeRecoveryRedirect(body.redirectTo)

    if (!email) {
      return NextResponse.json({ error: "Correo requerido." }, { status: 400 })
    }

    const rateLimitConfig = readAuthRateLimitConfig("auth-recover", {
      limit: 6,
      windowMs: 10 * 60 * 1000,
    })

    if (rateLimitConfig.enabled) {
      const rateLimit = consumeAuthRateLimit({
        key: buildAuthRateLimitKey(request, "auth-recover", email),
        limit: rateLimitConfig.limit,
        windowMs: rateLimitConfig.windowMs,
      })

      if (!rateLimit.ok) {
        logSecurityEvent(request, {
          event: "auth.recover.rate_limited",
          severity: "warn",
          message: "Rate limit reached for recover route.",
          tags: ["auth", "recover", "rate-limit"],
          metadata: { emailDomain: getDomain(email) || "unknown" },
        })
        return NextResponse.json(
          { error: "Demasiadas solicitudes de recuperación. Espere e intente nuevamente." },
          {
            status: 429,
            headers: {
              "Retry-After": String(rateLimit.retryAfterSec),
            },
          }
        )
      }
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
      logSecurityEvent(request, {
        event: "auth.recover.provider_rejected",
        severity: "warn",
        message: String(error.message ?? "Recover provider rejected."),
        tags: ["auth", "recover", "provider"],
        metadata: { emailDomain: getDomain(email) || "unknown" },
      })
      return NextResponse.json({ error: error.message || "No se pudo enviar el correo de recuperación." }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAuthTimeoutError(error)) {
      logSecurityEvent(request, {
        event: "auth.recover.timeout",
        severity: "warn",
        message: "Timeout while requesting password recovery.",
        tags: ["auth", "recover", "timeout"],
      })
      return NextResponse.json({ error: "La recuperación de clave tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    logSecurityEvent(request, {
      event: "auth.recover.unexpected_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Unexpected recover error.",
      tags: ["auth", "recover", "exception"],
    })
    return NextResponse.json({ error: "Error inesperado solicitando recuperación." }, { status: 500 })
  }
}