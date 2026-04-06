import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"

export function getBearerTokenFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization")
  return authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : ""
}

export function createRequestSupabaseClient(accessToken: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !anonKey) {
    throw new Error("Falta configuración pública de Supabase.")
  }

  return createSupabaseClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  })
}