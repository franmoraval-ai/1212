import type { SupabaseClient } from "@supabase/supabase-js"

export function splitAssignedScope(raw: unknown) {
  const [operationName = "", postName = ""] = String(raw ?? "")
    .split("|")
    .map((value) => value.trim())

  return { operationName, postName }
}

export function buildAssignedScope(operationName: string, postName: string) {
  return `${operationName.trim()} | ${postName.trim()}`
}

export async function validateL1Assignment(admin: SupabaseClient, assigned: string) {
  const { operationName, postName } = splitAssignedScope(assigned)

  if (!operationName || !postName) {
    return { ok: false, error: "Para L1 debe definir operación y puesto del catálogo.", status: 400 }
  }

  const { data, error } = await admin
    .from("operation_catalog")
    .select("id,is_active")
    .eq("operation_name", operationName)
    .eq("client_name", postName)
    .limit(5)

  if (error) {
    const message = String(error.message ?? "")
    if (message.toLowerCase().includes("operation_catalog")) {
      return { ok: false, error: "No se pudo validar catálogo de operaciones/puestos.", status: 503 }
    }
    return { ok: false, error: "No se pudo validar la asignación L1.", status: 500 }
  }

  const exists = (data ?? []).some((row) => (row as { is_active?: boolean | null }).is_active !== false)
  if (!exists) {
    return { ok: false, error: "La operación y puesto seleccionados ya no están activos en el catálogo.", status: 400 }
  }

  return { ok: true, error: null, status: 200 }
}