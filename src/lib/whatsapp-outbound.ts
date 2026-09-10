import type { SupabaseClient } from "@supabase/supabase-js"

export function normalizeWhatsappPhone(value: unknown) {
  return String(value ?? "").replace(/[^0-9]/g, "")
}

type EnqueueResult =
  | { queued: true }
  | { queued: false; reason: "no-phone" | "insert-error" | "no-user" | "user-lookup-failed"; error?: string }

// Never throws: notification delivery must not break the primary flow (incident/finding creation) that triggers it.
export async function enqueueWhatsappMessage(
  admin: SupabaseClient,
  input: { toUserId?: string | null; toPhone?: string | null; message: string; context?: string }
): Promise<EnqueueResult> {
  try {
    const phone = normalizeWhatsappPhone(input.toPhone)
    if (!phone || phone.length < 8) return { queued: false, reason: "no-phone" }

    const { error } = await admin.from("whatsapp_outbound_messages").insert({
      to_phone: phone,
      to_user_id: input.toUserId || null,
      message: input.message,
      context: input.context ?? null,
    })

    if (error) return { queued: false, reason: "insert-error", error: error.message }
    return { queued: true }
  } catch (error) {
    return { queued: false, reason: "insert-error", error: error instanceof Error ? error.message : "unknown" }
  }
}

export async function enqueueWhatsappMessageForUserId(
  admin: SupabaseClient,
  userId: string,
  message: string,
  context?: string
): Promise<EnqueueResult> {
  try {
    const normalizedUserId = String(userId ?? "").trim()
    if (!normalizedUserId) return { queued: false, reason: "no-user" }

    const { data, error } = await admin
      .from("users")
      .select("id,whatsapp_phone")
      .eq("id", normalizedUserId)
      .maybeSingle()

    if (error || !data) return { queued: false, reason: "user-lookup-failed" }

    return enqueueWhatsappMessage(admin, {
      toUserId: normalizedUserId,
      toPhone: (data as { whatsapp_phone?: string | null }).whatsapp_phone,
      message,
      context,
    })
  } catch (error) {
    return { queued: false, reason: "user-lookup-failed", error: error instanceof Error ? error.message : "unknown" }
  }
}
