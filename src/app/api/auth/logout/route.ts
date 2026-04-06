import { NextResponse } from "next/server"
import { cookies } from "next/headers"

function isAuthCookie(name: string) {
  return name.startsWith("sb-") || name.includes("supabase") || name.includes("auth-token")
}

export async function POST() {
  const cookieStore = await cookies()
  const response = NextResponse.json(
    { ok: true },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  )

  cookieStore.getAll().forEach(({ name }) => {
    if (!isAuthCookie(name)) return
    response.cookies.set(name, "", { maxAge: 0, path: "/" })
  })

  return response
}