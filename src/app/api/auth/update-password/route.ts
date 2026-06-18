import { NextResponse } from "next/server"
import { isAuthTimeoutError, withAuthTimeout } from "@/lib/auth-route-timeout"
import { createClient as createSessionClient } from "@/lib/supabase-server"
import { getAdminClient } from "@/lib/server-auth"
import { buildAuthRateLimitKey, consumeAuthRateLimit, readAuthRateLimitConfig } from "@/lib/auth-rate-limit"
import { logSecurityEvent } from "@/lib/security-telemetry"
import { validateStrongPassword } from "@/lib/password-policy"

async function resolveAuthenticatedUserId(request: Request) {
  const { admin } = getAdminClient()
  if (!admin) {
    return { userId: null, error: "No se pudo inicializar autenticación del servidor.", status: 500 }
  }

  const sessionClient = await createSessionClient()
  const {
    data: { user: cookieUser },
  } = await sessionClient.auth.getUser()

  if (cookieUser?.id) {
    return { userId: cookieUser.id, error: null, status: 200 }
  }

  const authHeader = request.headers.get("authorization")
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""

  if (!bearerToken) {
    return { userId: null, error: "No autenticado.", status: 401 }
  }

  const {
    data: { user },
    error,
  } = await admin.auth.getUser(bearerToken)

  if (error || !user?.id) {
    return { userId: null, error: "No autenticado.", status: 401 }
  }

  return { userId: user.id, error: null, status: 200 }
}

export async function POST(request: Request) {
  try {
    const rateLimitConfig = readAuthRateLimitConfig("auth-update-password", {
      limit: 8,
      windowMs: 10 * 60 * 1000,
    })

    if (rateLimitConfig.enabled) {
      const rateLimit = consumeAuthRateLimit({
        key: buildAuthRateLimitKey(request, "auth-update-password"),
        limit: rateLimitConfig.limit,
        windowMs: rateLimitConfig.windowMs,
      })

      if (!rateLimit.ok) {
        logSecurityEvent(request, {
          event: "auth.update_password.rate_limited",
          severity: "warn",
          message: "Rate limit reached for password update route.",
          tags: ["auth", "update-password", "rate-limit"],
        })
        return NextResponse.json(
          { error: "Demasiadas solicitudes. Espere e intente nuevamente." },
          {
            status: 429,
            headers: {
              "Retry-After": String(rateLimit.retryAfterSec),
            },
          }
        )
      }
    }

    const body = (await request.json()) as {
      password?: string
    }

    const password = String(body.password ?? "")
    const validation = validateStrongPassword(password)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.message }, { status: 400 })
    }

    const { userId, error: authError, status } = await resolveAuthenticatedUserId(request)
    if (!userId) {
      logSecurityEvent(request, {
        event: "auth.update_password.unauthenticated",
        severity: "warn",
        message: String(authError ?? "Unauthenticated password update request."),
        tags: ["auth", "update-password", "unauthenticated"],
      })
      return NextResponse.json({ error: authError ?? "No autenticado." }, { status })
    }

    const { admin, error: adminError } = getAdminClient()
    if (!admin) {
      return NextResponse.json({ error: adminError ?? "No se pudo actualizar la clave." }, { status: 500 })
    }

    const { error } = await withAuthTimeout(
      admin.auth.admin.updateUserById(userId, { password }),
      "La actualización de clave tardó demasiado en responder."
    )
    if (error) {
      logSecurityEvent(request, {
        event: "auth.update_password.provider_rejected",
        severity: "warn",
        message: String(error.message ?? "Password update rejected."),
        tags: ["auth", "update-password", "provider"],
      })
      return NextResponse.json({ error: error.message || "No se pudo actualizar la clave." }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAuthTimeoutError(error)) {
      logSecurityEvent(request, {
        event: "auth.update_password.timeout",
        severity: "warn",
        message: "Timeout while updating password.",
        tags: ["auth", "update-password", "timeout"],
      })
      return NextResponse.json({ error: "La actualización de clave tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    logSecurityEvent(request, {
      event: "auth.update_password.unexpected_error",
      severity: "error",
      message: error instanceof Error ? error.message : "Unexpected password update error.",
      tags: ["auth", "update-password", "exception"],
    })
    return NextResponse.json({ error: "Error inesperado actualizando clave." }, { status: 500 })
  }
}