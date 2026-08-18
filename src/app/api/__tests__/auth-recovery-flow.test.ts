import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  createSessionClientMock,
  exchangeCodeForSessionMock,
  resetPasswordForEmailMock,
} = vi.hoisted(() => ({
  createSessionClientMock: vi.fn(),
  exchangeCodeForSessionMock: vi.fn(),
  resetPasswordForEmailMock: vi.fn(),
}))

vi.mock("@/lib/supabase-server", () => ({ createClient: createSessionClientMock }))

import { GET as callbackGet } from "@/app/auth/callback/route"
import { POST as recoverPost } from "@/app/api/auth/recover/route"

describe("password recovery flow", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("AUTH_RATE_LIMIT_ENABLED", "false")
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hoseguridad.com")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key")
    resetPasswordForEmailMock.mockResolvedValue({ data: {}, error: null })
    exchangeCodeForSessionMock.mockResolvedValue({ data: { session: {} }, error: null })
    createSessionClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: exchangeCodeForSessionMock,
        resetPasswordForEmail: resetPasswordForEmailMock,
      },
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("requests a PKCE recovery link through the cookie-aware SSR client", async () => {
    const response = await recoverPost(new Request("https://hoseguridad.com/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "usuario@hoseguridad.com",
        redirectTo: "https://hoseguridad.com/auth/callback",
      }),
    }))

    expect(response.status).toBe(200)
    expect(createSessionClientMock).toHaveBeenCalledTimes(1)
    expect(resetPasswordForEmailMock).toHaveBeenCalledWith("usuario@hoseguridad.com", {
      redirectTo: "https://hoseguridad.com/auth/callback",
    })
  })

  it("exchanges the callback code and opens the recovery form", async () => {
    const response = await callbackGet(new Request(
      "https://hoseguridad.com/auth/callback?code=recovery-code&next=%2Flogin%3Frecovery%3D1",
    ))

    expect(response.status).toBe(307)
    expect(exchangeCodeForSessionMock).toHaveBeenCalledWith("recovery-code")
    expect(response.headers.get("location")).toBe("https://hoseguridad.com/login?recovery=1")
  })

  it("does not allow an external post-recovery redirect", async () => {
    const response = await callbackGet(new Request(
      "https://hoseguridad.com/auth/callback?code=recovery-code&next=https%3A%2F%2Fevil.example",
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://hoseguridad.com/login?recovery=1")
  })

  it("returns expired or rejected links to login with a safe error state", async () => {
    exchangeCodeForSessionMock.mockResolvedValue({ data: { session: null }, error: { message: "expired" } })

    const response = await callbackGet(new Request(
      "https://hoseguridad.com/auth/callback?code=expired-code",
    ))

    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe("https://hoseguridad.com/login?recovery_error=invalid")
  })
})
