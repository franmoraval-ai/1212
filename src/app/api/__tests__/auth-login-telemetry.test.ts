import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as loginPost } from "@/app/api/auth/login/route"

declare global {
  var __hoAuthRateLimitStore: Map<string, { count: number; resetAt: number }> | undefined
}

function createLoginRequest(email: string) {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.88",
    },
    body: JSON.stringify({
      email,
      password: "secret-123",
    }),
  })
}

function findSecurityEvent(calls: unknown[][], eventName: string) {
  for (const call of calls) {
    const serialized = String(call[0] ?? "")
    try {
      const parsed = JSON.parse(serialized) as {
        event?: string
        severity?: string
        path?: string
        tags?: string[]
        metadata?: Record<string, unknown>
      }
      if (parsed.event === eventName) return parsed
    } catch {
      // Ignore non-JSON logs.
    }
  }
  return null
}

describe("/api/auth/login telemetry", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://supabase.example.test")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    globalThis.__hoAuthRateLimitStore = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    globalThis.__hoAuthRateLimitStore = undefined
  })

  it("emits warn telemetry when provider rejects login with 4xx", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error_description: "Credenciales inválidas" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    ))

    const response = await loginPost(createLoginRequest("warn-provider@hoseguridad.com"))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toMatchObject({ error: "Credenciales inválidas" })

    const event = findSecurityEvent(warnSpy.mock.calls, "auth.login.provider_rejected")
    expect(event).toMatchObject({
      event: "auth.login.provider_rejected",
      severity: "warn",
      path: "/api/auth/login",
      tags: ["auth", "login", "provider"],
      metadata: { status: 401, emailDomain: "hoseguridad.com" },
    })
    expect(findSecurityEvent(errorSpy.mock.calls, "auth.login.provider_rejected")).toBeNull()
  })

  it("emits error telemetry when provider rejects login with 5xx", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ error: "Proveedor caído" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }),
    ))

    const response = await loginPost(createLoginRequest("error-provider@hoseguridad.com"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: "Proveedor caído" })

    const event = findSecurityEvent(errorSpy.mock.calls, "auth.login.provider_rejected")
    expect(event).toMatchObject({
      event: "auth.login.provider_rejected",
      severity: "error",
      path: "/api/auth/login",
      tags: ["auth", "login", "provider"],
      metadata: { status: 500, emailDomain: "hoseguridad.com" },
    })
    expect(findSecurityEvent(warnSpy.mock.calls, "auth.login.provider_rejected")).toBeNull()
  })

  it("emits warn telemetry and returns 504 on timeout", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    vi.stubGlobal("fetch", vi.fn(async () => {
      const timeoutError = new Error("upstream timeout")
      timeoutError.name = "TimeoutError"
      throw timeoutError
    }))

    const response = await loginPost(createLoginRequest("timeout-provider@hoseguridad.com"))
    const body = await response.json()

    expect(response.status).toBe(504)
    expect(body).toMatchObject({ error: "El acceso tardó demasiado en responder. Intente nuevamente." })

    const event = findSecurityEvent(warnSpy.mock.calls, "auth.login.timeout")
    expect(event).toMatchObject({
      event: "auth.login.timeout",
      severity: "warn",
      path: "/api/auth/login",
      tags: ["auth", "login", "timeout"],
    })
  })
})
