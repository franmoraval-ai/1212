import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { POST as loginPost } from "@/app/api/auth/login/route"
import { POST as recoverPost } from "@/app/api/auth/recover/route"
import { POST as signupPost } from "@/app/api/auth/signup/route"
import { POST as updatePasswordPost } from "@/app/api/auth/update-password/route"

declare global {
  var __hoAuthRateLimitStore: Map<string, { count: number; resetAt: number }> | undefined
}

type RouteHandler = (request: Request) => Promise<Response>

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

function createJsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.77",
    },
    body: JSON.stringify(body),
  })
}

async function exhaustWindow(routeHandler: RouteHandler, attempts: number, requestFactory: () => Request) {
  for (let index = 0; index < attempts; index += 1) {
    await routeHandler(requestFactory())
  }

  return routeHandler(requestFactory())
}

describe("auth routes rate-limit contract", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-05T00:00:00.000Z"))
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    globalThis.__hoAuthRateLimitStore = undefined
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    globalThis.__hoAuthRateLimitStore = undefined
  })

  it("returns 429 with Retry-After for login route when limit is exhausted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined)

    const response = await exhaustWindow(loginPost, 10, () =>
      createJsonRequest("http://localhost/api/auth/login", {
        email: "rate-login@hoseguridad.com",
        password: "x",
      }),
    )

    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({ error: "Demasiados intentos. Espere un momento e intente de nuevo." })
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1)

    const event = findSecurityEvent(warnSpy.mock.calls, "auth.login.rate_limited")
    expect(event).toMatchObject({
      event: "auth.login.rate_limited",
      severity: "warn",
      path: "/api/auth/login",
      tags: ["auth", "login", "rate-limit"],
      metadata: { emailDomain: "hoseguridad.com" },
    })
  })

  it("returns 429 with Retry-After for recover route when limit is exhausted", async () => {
    const response = await exhaustWindow(recoverPost, 6, () =>
      createJsonRequest("http://localhost/api/auth/recover", {
        email: "rate-recover@hoseguridad.com",
        redirectTo: "/login",
      }),
    )

    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({ error: "Demasiadas solicitudes de recuperación. Espere e intente nuevamente." })
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1)
  })

  it("returns 429 with Retry-After for signup route when limit is exhausted", async () => {
    const response = await exhaustWindow(signupPost, 6, () =>
      createJsonRequest("http://localhost/api/auth/signup", {
        fullName: "Rate Limited",
        email: "rate-signup@hoseguridad.com",
        password: "123",
      }),
    )

    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({ error: "Demasiados intentos de registro. Espere e intente nuevamente." })
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1)
  })

  it("returns 429 with Retry-After for update-password route when limit is exhausted", async () => {
    const response = await exhaustWindow(updatePasswordPost, 8, () =>
      createJsonRequest("http://localhost/api/auth/update-password", {
        password: "123",
      }),
    )

    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body).toMatchObject({ error: "Demasiadas solicitudes. Espere e intente nuevamente." })
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1)
  })
})
