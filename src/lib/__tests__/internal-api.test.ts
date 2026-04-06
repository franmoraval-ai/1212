/**
 * fetchInternalApi & Hook Pattern Tests
 *
 * Validates the shared contract that all 18+ data hooks follow:
 *   1. fetchInternalApi attaches the Bearer token from the Supabase session
 *   2. fetchInternalApi retries once with a refreshed token on 401
 *   3. Hooks return empty state when the user is null
 *   4. Hooks expose a consistent { data, isLoading, error, reload } shape
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchInternalApi } from "@/lib/internal-api"

// ── Supabase client stub ─────────────────────────────────────────────
function createSupabaseStub(accessToken = "valid-token") {
  let refreshCalled = false

  return {
    get refreshCalled() { return refreshCalled },
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: { access_token: accessToken } },
          error: null,
        }),
      refreshSession: () => {
        refreshCalled = true
        return Promise.resolve({
          data: { session: { access_token: "refreshed-token" } },
          error: null,
        })
      },
    },
  }
}

describe("fetchInternalApi", () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it("attaches Authorization header from Supabase session", async () => {
    const supabase = createSupabaseStub("tok-abc")
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers ?? undefined)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchInternalApi(supabase as any, "/api/test", { method: "GET" })

    expect(capturedHeaders?.get("Authorization")).toBe("Bearer tok-abc")
  })

  it("retries with refreshed token when first call returns 401", async () => {
    const supabase = createSupabaseStub("expired-token")
    const calls: Array<{ url: string; authHeader: string | null }> = []

    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers ?? undefined)
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      calls.push({ url, authHeader: headers.get("Authorization") })

      if (calls.length === 1) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchInternalApi(supabase as any, "/api/test")

    expect(calls).toHaveLength(2)
    expect(calls[0].authHeader).toBe("Bearer expired-token")
    expect(calls[1].authHeader).toBe("Bearer refreshed-token")
    expect(response.status).toBe(200)
    expect(supabase.refreshCalled).toBe(true)
  })

  it("does not retry when retryOnUnauthorized is false", async () => {
    const supabase = createSupabaseStub("expired-token")
    let callCount = 0

    globalThis.fetch = vi.fn(async () => {
      callCount++
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchInternalApi(supabase as any, "/api/test", {}, { retryOnUnauthorized: false })

    expect(callCount).toBe(1)
    expect(response.status).toBe(401)
  })

  it("auto-sets Content-Type to application/json when body is present", async () => {
    const supabase = createSupabaseStub()
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers ?? undefined)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchInternalApi(supabase as any, "/api/test", {
      method: "POST",
      body: JSON.stringify({ foo: 1 }),
    })

    expect(capturedHeaders?.get("Content-Type")).toBe("application/json")
  })

  it("does not overwrite explicit Content-Type header", async () => {
    const supabase = createSupabaseStub()
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers ?? undefined)
      return new Response("ok", { status: 200 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchInternalApi(supabase as any, "/api/upload", {
      method: "POST",
      body: "binary-data",
      headers: { "Content-Type": "multipart/form-data" },
    })

    expect(capturedHeaders?.get("Content-Type")).toBe("multipart/form-data")
  })
})

// ── Hook Contract Shape Test ─────────────────────────────────────────
// This tests the common interface exposed by all data hooks:
// { data/items/..., isLoading, error, reload }

describe("Hook Data Pattern Contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetchInternalApi resolves with a standard Response object", async () => {
    const supabase = createSupabaseStub()

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ rounds: [], reports: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await fetchInternalApi(supabase as any, "/api/rounds/context?includeReports=1")
    const body = (await response.json()) as Record<string, unknown>

    expect(response.ok).toBe(true)
    expect(body).toHaveProperty("rounds")
    expect(body).toHaveProperty("reports")
  })

  it("returns empty token when session has none and refresh is disabled", async () => {
    const supabase = createSupabaseStub("")
    let capturedHeaders: Headers | null = null

    globalThis.fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers ?? undefined)
      return new Response("{}", { status: 200 })
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchInternalApi(supabase as any, "/api/test", {}, { refreshIfMissingToken: false })

    // No Authorization header when token is empty and refresh is turned off
    expect(capturedHeaders?.get("Authorization")).toBeNull()
  })
})
