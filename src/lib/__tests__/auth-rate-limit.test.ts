import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildAuthRateLimitKey, consumeAuthRateLimit, getClientIp } from "@/lib/auth-rate-limit"

declare global {
  var __hoAuthRateLimitStore: Map<string, { count: number; resetAt: number }> | undefined
}

describe("auth rate limit", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-05-05T00:00:00.000Z"))
    globalThis.__hoAuthRateLimitStore = undefined
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.__hoAuthRateLimitStore = undefined
  })

  it("extracts client ip with expected header priority", () => {
    const forwarded = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 70.0.0.1",
        "x-real-ip": "198.51.100.22",
        "cf-connecting-ip": "192.0.2.55",
      },
    })
    expect(getClientIp(forwarded)).toBe("203.0.113.10")

    const realIp = new Request("http://localhost", {
      headers: {
        "x-real-ip": "198.51.100.22",
      },
    })
    expect(getClientIp(realIp)).toBe("198.51.100.22")

    const cloudflare = new Request("http://localhost", {
      headers: {
        "cf-connecting-ip": "192.0.2.55",
      },
    })
    expect(getClientIp(cloudflare)).toBe("192.0.2.55")

    expect(getClientIp(new Request("http://localhost"))).toBe("unknown")
  })

  it("normalizes scope, ip and identity when building key", () => {
    const request = new Request("http://localhost", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
      },
    })

    expect(buildAuthRateLimitKey(request, " Auth-Login ", " USER@DEMO.TEST ")).toBe("auth-login:203.0.113.10:user@demo.test")
    expect(buildAuthRateLimitKey(request, "auth-login")).toBe("auth-login:203.0.113.10:anon")
  })

  it("enforces limits and recovers after the configured time window", () => {
    const first = consumeAuthRateLimit({ key: "auth-login:203.0.113.10:user@demo.test", limit: 2, windowMs: 60_000 })
    const second = consumeAuthRateLimit({ key: "auth-login:203.0.113.10:user@demo.test", limit: 2, windowMs: 60_000 })
    const blockedAtStart = consumeAuthRateLimit({ key: "auth-login:203.0.113.10:user@demo.test", limit: 2, windowMs: 60_000 })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(blockedAtStart.ok).toBe(false)
    expect(blockedAtStart.retryAfterSec).toBe(60)

    vi.advanceTimersByTime(30_000)
    const blockedMidWindow = consumeAuthRateLimit({ key: "auth-login:203.0.113.10:user@demo.test", limit: 2, windowMs: 60_000 })
    expect(blockedMidWindow.ok).toBe(false)
    expect(blockedMidWindow.retryAfterSec).toBe(30)

    vi.advanceTimersByTime(30_001)
    const acceptedAfterReset = consumeAuthRateLimit({ key: "auth-login:203.0.113.10:user@demo.test", limit: 2, windowMs: 60_000 })
    expect(acceptedAfterReset.ok).toBe(true)
    expect(acceptedAfterReset.retryAfterSec).toBe(60)
  })

  it("cleans expired buckets even when the store is small", () => {
    vi.setSystemTime(new Date("2026-05-05T01:00:00.000Z"))
    const now = Date.now()
    globalThis.__hoAuthRateLimitStore = new Map([
      ["expired:key", { count: 2, resetAt: now - 1 }],
    ])

    const result = consumeAuthRateLimit({ key: "fresh:key", limit: 2, windowMs: 60_000 })

    expect(result.ok).toBe(true)
    expect(globalThis.__hoAuthRateLimitStore?.has("expired:key")).toBe(false)
    expect(globalThis.__hoAuthRateLimitStore?.has("fresh:key")).toBe(true)
  })
})
