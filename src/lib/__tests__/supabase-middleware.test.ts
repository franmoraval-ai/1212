import { describe, expect, it } from "vitest"
import { hasSupabaseAuthCookies, isPrefetchRequest, shouldRefreshSupabaseSession } from "@/lib/supabase-middleware"

function createRequestLike(input?: {
  method?: string
  headers?: Record<string, string>
  cookies?: Array<{ name: string }>
}) {
  return {
    method: input?.method ?? "GET",
    headers: new Headers(input?.headers ?? {}),
    cookies: {
      getAll: () => input?.cookies ?? [],
    },
  }
}

describe("supabase-middleware helpers", () => {
  it("detects Supabase auth cookies", () => {
    expect(hasSupabaseAuthCookies([{ name: "sb-project-auth-token" }])).toBe(true)
    expect(hasSupabaseAuthCookies([{ name: "other-cookie" }])).toBe(false)
  })

  it("detects prefetch requests", () => {
    expect(isPrefetchRequest(createRequestLike({ headers: { purpose: "prefetch" } }))).toBe(true)
    expect(isPrefetchRequest(createRequestLike({ headers: { "next-router-prefetch": "1" } }))).toBe(true)
    expect(isPrefetchRequest(createRequestLike())).toBe(false)
  })

  it("refreshes only for real navigations with auth cookies", () => {
    expect(shouldRefreshSupabaseSession(createRequestLike())).toBe(false)
    expect(shouldRefreshSupabaseSession(createRequestLike({ cookies: [{ name: "sb-project-auth-token" }] }))).toBe(true)
    expect(shouldRefreshSupabaseSession(createRequestLike({ method: "POST", cookies: [{ name: "sb-project-auth-token" }] }))).toBe(false)
    expect(shouldRefreshSupabaseSession(createRequestLike({
      headers: { purpose: "prefetch" },
      cookies: [{ name: "sb-project-auth-token" }],
    }))).toBe(false)
  })
})