import { createHash } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

export function hashShiftPin(pin: string) {
  return createHash("sha256").update(`ho-station-shift:${pin}`).digest("hex")
}

export function normalizeShiftNfcCode(value: unknown) {
  return String(value ?? "").trim().toUpperCase()
}

export async function ensureUniqueShiftNfcCode(
  admin: SupabaseClient,
  shiftNfcCode: string,
  excludingUserId?: string | null,
) {
  const normalized = normalizeShiftNfcCode(shiftNfcCode)
  if (!normalized) {
    return { ok: true, normalized, status: 200, error: null }
  }

  const { data, error } = await admin
    .from("users")
    .select("id")
    .eq("shift_nfc_code", normalized)
    .limit(5)

  if (error) {
    const message = String(error.message ?? "")
    if (message.toLowerCase().includes("shift_nfc_code")) {
      return { ok: false, normalized, status: 503, error: "Ejecute supabase/add_shift_nfc_unique_index.sql antes de configurar NFC de relevo." }
    }
    return { ok: false, normalized, status: 500, error: "No se pudo validar unicidad del NFC de relevo." }
  }

  const conflict = (data ?? []).some((row) => String((row as { id?: string | null }).id ?? "").trim() !== String(excludingUserId ?? "").trim())
  if (conflict) {
    return { ok: false, normalized, status: 409, error: "Ese NFC de relevo ya está asignado a otro usuario." }
  }

  return { ok: true, normalized, status: 200, error: null }
}