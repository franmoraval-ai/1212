import { NextResponse } from "next/server"
import { AUTH_ROUTE_TIMEOUT_MS, isAuthTimeoutError } from "@/lib/auth-route-timeout"
import { buildAuthRateLimitKey, consumeAuthRateLimit, readAuthRateLimitConfig } from "@/lib/auth-rate-limit"
import { logSecurityEvent } from "@/lib/security-telemetry"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

function getDomain(email: string) {
  return email.toLowerCase().split("@")[1] ?? ""
}

export async function POST(request: Request) {
  try {
    const { email: rawEmail, password } = (await request.json()) as {
      email?: string
      password?: string
    }

    const email = String(rawEmail ?? "").trim().toLowerCase()
    const safePassword = String(password ?? "")

    if (!email || !safePassword) {
      return NextResponse.json({ error: "Correo y clave son obligatorios." }, { status: 400 })
    }

    const rateLimitConfig = readAuthRateLimitConfig("auth-login", {
      limit: 10,
      windowMs: 5 * 60 * 1000,
    })

    if (rateLimitConfig.enabled) {
      const rateLimit = consumeAuthRateLimit({
        key: buildAuthRateLimitKey(request, "auth-login", email),
        limit: rateLimitConfig.limit,
        windowMs: rateLimitConfig.windowMs,
      })

      if (!rateLimit.ok) {
        logSecurityEvent(request, {
          event: "auth.login.rate_limited",
          severity: "warn",
          message: "Rate limit reached for login route.",
          tags: ["auth", "login", "rate-limit"],
          metadata: { emailDomain: getDomain(email) || "unknown" },
        })
        return NextResponse.json(
          { error: "Demasiados intentos. Espere un momento e intente de nuevo." },
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

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password: safePassword }),
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(AUTH_ROUTE_TIMEOUT_MS)
        : undefined,
    })

    const payload = await authResponse.json().catch(() => null)

    if (!authResponse.ok) {
      const message =
        String(payload?.msg ?? payload?.error_description ?? payload?.error ?? "").trim() ||
        "No se pudo autenticar el usuario."

      logSecurityEvent(request, {
        event: "auth.login.provider_rejected",
        severity: authResponse.status >= 500 ? "error" : "warn",
        message,
        tags: ["auth", "login", "provider"],
        metadata: { status: authResponse.status, emailDomain: getDomain(email) || "unknown" },
      })

      return NextResponse.json({ error: message }, { status: authResponse.status })
    }

    return NextResponse.json(
      {
        ok: true,
        session: {
          access_token: String(payload?.access_token ?? ""),
          refresh_token: String(payload?.refresh_token ?? ""),
          expires_at: Number(payload?.expires_at ?? 0),
          expires_in: Number(payload?.expires_in ?? 0),
          token_type: String(payload?.token_type ?? "bearer"),
          user: payload?.user ?? null,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    )
  } catch (error) {
    if (isAuthTimeoutError(error) || (error instanceof Error && error.name === "TimeoutError")) {
      logSecurityEvent(request, {
        event: "auth.login.timeout",
        severity: "warn",
        message: "Timeout while authenticating user.",
        tags: ["auth", "login", "timeout"],
      })
      return NextResponse.json({ error: "El acceso tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    logSecurityEvent(request, {
      event: "auth.login.unexpected_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Unexpected login error.",
      tags: ["auth", "login", "exception"],
    })
    return NextResponse.json({ error: "Error inesperado autenticando usuario." }, { status: 500 })
  }
}