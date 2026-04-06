import { NextResponse } from "next/server"
import { isAuthTimeoutError, withAuthTimeout } from "@/lib/auth-route-timeout"
import { createClient as createSessionClient } from "@/lib/supabase-server"
import { getAdminClient } from "@/lib/server-auth"
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
      return NextResponse.json({ error: error.message || "No se pudo actualizar la clave." }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (isAuthTimeoutError(error)) {
      return NextResponse.json({ error: "La actualización de clave tardó demasiado en responder. Intente nuevamente." }, { status: 504 })
    }
    return NextResponse.json({ error: "Error inesperado actualizando clave." }, { status: 500 })
  }
}