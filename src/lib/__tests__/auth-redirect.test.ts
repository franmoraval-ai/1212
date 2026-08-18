import { beforeEach, describe, expect, it, vi } from "vitest"
import { sanitizeRecoveryRedirect } from "@/lib/auth-redirect"

describe("auth redirect sanitizer", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://hoseguridad.com")
  })

  it("falls back to the default login URL when origin is not allowed", () => {
    const result = sanitizeRecoveryRedirect("https://evil.example/phishing")
    expect(result).toBe("https://hoseguridad.com/auth/callback")
  })

  it("rejects non-callback paths on an allowed origin", () => {
    const result = sanitizeRecoveryRedirect("/login?from=recover")
    expect(result).toBe("https://hoseguridad.com/auth/callback")
  })

  it("accepts explicit origins configured by AUTH_RECOVERY_ALLOWED_ORIGINS", () => {
    vi.stubEnv("AUTH_RECOVERY_ALLOWED_ORIGINS", "https://preprod.hoseguridad.com")
    const result = sanitizeRecoveryRedirect("https://preprod.hoseguridad.com/auth/callback")
    expect(result).toBe("https://preprod.hoseguridad.com/auth/callback")
  })
})
