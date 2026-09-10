import type { SupabaseClient } from "@supabase/supabase-js"
import { enqueueWhatsappMessageForUserId } from "@/lib/whatsapp-outbound"

function escapeForIlike(value: string) {
  return value.replace(/[%_\\]/g, (match) => `\\${match}`)
}

async function resolveOperationCatalogId(admin: SupabaseClient, operationName: string, postName: string) {
  if (operationName && postName) {
    const { data } = await admin
      .from("operation_catalog")
      .select("id")
      .ilike("operation_name", escapeForIlike(operationName))
      .ilike("client_name", escapeForIlike(postName))
      .eq("is_active", true)
      .limit(2)
    if ((data ?? []).length === 1) return String((data as { id: string }[])[0].id)
  }

  if (postName) {
    const { data } = await admin
      .from("operation_catalog")
      .select("id")
      .ilike("client_name", escapeForIlike(postName))
      .eq("is_active", true)
      .limit(2)
    if ((data ?? []).length === 1) return String((data as { id: string }[])[0].id)
  }

  return null
}

// Notifies the L2 account manager + their L3 for a station; falls back to all L4 if no mapping exists.
export async function notifyStationManagers(
  admin: SupabaseClient,
  input: { operationName?: string; postName?: string; message: string; context: string }
) {
  try {
    const operationName = String(input.operationName ?? "").trim()
    const postName = String(input.postName ?? "").trim()
    if (!postName) return { notified: 0 }

    const catalogId = await resolveOperationCatalogId(admin, operationName, postName)
    if (!catalogId) return { notified: 0 }

    const recipientIds = new Set<string>()

    const { data: assignments } = await admin
      .from("l2_account_manager_assignments")
      .select("l2_user_id,l3_user_id")
      .eq("operation_catalog_id", catalogId)
      .eq("is_active", true)

    for (const row of (assignments ?? []) as { l2_user_id?: string | null; l3_user_id?: string | null }[]) {
      if (row.l2_user_id) recipientIds.add(row.l2_user_id)
      if (row.l3_user_id) recipientIds.add(row.l3_user_id)
    }

    if (recipientIds.size === 0) {
      const { data: directors } = await admin.from("users").select("id").eq("role_level", 4)
      for (const row of (directors ?? []) as { id: string }[]) recipientIds.add(row.id)
    }

    let notified = 0
    for (const userId of recipientIds) {
      const result = await enqueueWhatsappMessageForUserId(admin, userId, input.message, input.context)
      if (result.queued) notified += 1
    }
    return { notified }
  } catch {
    return { notified: 0 }
  }
}
