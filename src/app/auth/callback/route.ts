import { NextResponse } from "next/server"
import { createClient as createSessionClient } from "@/lib/supabase-server"

const RECOVERY_FORM_PATH = "/login?recovery=1"
const RECOVERY_ERROR_PATH = "/login?recovery_error=invalid"

function sanitizeNextPath(value: unknown) {
  const candidate = String(value ?? "").trim()
  if (!candidate.startsWith("/")) return RECOVERY_FORM_PATH

  try {
    const base = new URL("https://app.local")
    const parsed = new URL(candidate, base)
    if (parsed.origin !== base.origin) return RECOVERY_FORM_PATH
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return RECOVERY_FORM_PATH
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = String(requestUrl.searchParams.get("code") ?? "").trim()
  const providerError = requestUrl.searchParams.get("error") || requestUrl.searchParams.get("error_code")

  if (!code || providerError) {
    return NextResponse.redirect(new URL(RECOVERY_ERROR_PATH, requestUrl.origin))
  }

  try {
    const supabase = await createSessionClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
      return NextResponse.redirect(new URL(RECOVERY_ERROR_PATH, requestUrl.origin))
    }

    return NextResponse.redirect(new URL(sanitizeNextPath(requestUrl.searchParams.get("next")), requestUrl.origin))
  } catch {
    return NextResponse.redirect(new URL(RECOVERY_ERROR_PATH, requestUrl.origin))
  }
}
