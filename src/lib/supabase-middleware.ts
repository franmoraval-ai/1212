import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

type RequestLike = {
  method: string
  headers: Headers
  cookies: {
    getAll(): Array<{ name: string }>
  }
}

export function hasSupabaseAuthCookies(cookies: Array<{ name: string }>) {
  return cookies.some(({ name }) => name.startsWith("sb-") && name.includes("auth-token"))
}

export function isPrefetchRequest(request: Pick<RequestLike, "headers">) {
  const purpose = request.headers.get("purpose")?.trim().toLowerCase()
  return purpose === "prefetch"
    || request.headers.has("next-router-prefetch")
    || request.headers.get("x-middleware-prefetch") === "1"
}

export function shouldRefreshSupabaseSession(request: RequestLike) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false
  }

  if (isPrefetchRequest(request)) {
    return false
  }

  return hasSupabaseAuthCookies(request.cookies.getAll())
}

export async function updateSession(request: NextRequest) {
  if (!shouldRefreshSupabaseSession(request)) {
    return NextResponse.next({ request })
  }

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  await supabase.auth.getUser()

  return response
}