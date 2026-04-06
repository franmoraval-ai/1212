import type { SupabaseClient } from "@supabase/supabase-js"

export async function selectUserByNormalizedEmail<TRecord = Record<string, unknown>>(
  client: Pick<SupabaseClient, "from">,
  select: string,
  email: string
) {
  const normalizedEmail = String(email ?? "").trim().toLowerCase()

  const exactResult = await client
    .from("users")
    .select(select)
    .eq("email", normalizedEmail)
    .limit(1)
    .maybeSingle<TRecord>()

  if (exactResult.error || exactResult.data) {
    return exactResult
  }

  return client
    .from("users")
    .select(select)
    .ilike("email", normalizedEmail)
    .limit(1)
    .maybeSingle<TRecord>()
}