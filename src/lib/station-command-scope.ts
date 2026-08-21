import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { splitAssignedScope } from "@/lib/personnel-assignment"
import type { AuthenticatedActor } from "@/lib/server-auth"

export type CommandOperationCatalogRow = {
  id: string
  operation_name?: string | null
  client_name?: string | null
  is_active?: boolean | null
}

type AuthorizationRow = {
  is_active?: boolean | null
  valid_from?: string | null
  valid_to?: string | null
  operation_catalog?: CommandOperationCatalogRow | CommandOperationCatalogRow[] | null
}

type AccountManagerRow = {
  is_active?: boolean | null
  operation_catalog?: CommandOperationCatalogRow | CommandOperationCatalogRow[] | null
}

function isAuthorizationActive(row: AuthorizationRow, now = Date.now()) {
  if (row.is_active === false) return false
  const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null
  const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null
  if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
  if (validTo && Number.isFinite(validTo) && validTo < now) return false
  return true
}

function assignedFallback(actor: Pick<AuthenticatedActor, "assigned">) {
  const { operationName, postName } = splitAssignedScope(actor.assigned)
  if (!operationName || !postName) return []
  return [{
    id: `${operationName.trim().toUpperCase()}__${postName.trim().toUpperCase()}`,
    operation_name: operationName,
    client_name: postName,
    is_active: true,
  }]
}

function extractCatalogRows(rows: Array<AuthorizationRow | AccountManagerRow>) {
  return rows
    .filter((row) => row.is_active !== false)
    .map((row) => Array.isArray(row.operation_catalog) ? row.operation_catalog[0] : row.operation_catalog)
    .filter((row): row is CommandOperationCatalogRow => Boolean(row && row.is_active !== false))
}

function isAccountManagerSchemaMissing(message: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("l2_account_manager_assignments")
    && (normalized.includes("does not exist") || normalized.includes("schema cache") || normalized.includes("not find"))
}

export async function loadCommandOperationCatalog(
  admin: { from: (table: string) => any },
  actor: AuthenticatedActor
) {
  if (Number(actor.roleLevel ?? 0) >= 4) {
    const { data, error } = await admin
      .from("operation_catalog")
      .select("id,operation_name,client_name,is_active")
      .order("operation_name", { ascending: true })
    return {
      rows: (Array.isArray(data) ? data : []) as CommandOperationCatalogRow[],
      error: error ? String(error.message ?? "No se pudo cargar el catálogo operativo.") : null,
    }
  }

  const managedTeam = await loadManagedTeamScope(admin, actor)
  if (managedTeam.error) return { rows: [], error: managedTeam.error }

  const commandUserIds = Array.from(new Set([
    String(actor.userId ?? "").trim(),
    ...Array.from(managedTeam.scope.userIds),
  ].filter(Boolean)))

  const directResult = await admin
    .from("station_officer_authorizations")
    .select("is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(id,operation_name,client_name,is_active)")
    .in("officer_user_id", commandUserIds)
    .eq("is_active", true)

  const accountResult = Number(actor.roleLevel ?? 0) === 3
    ? await admin
      .from("l2_account_manager_assignments")
      .select("is_active,operation_catalog:operation_catalog_id(id,operation_name,client_name,is_active)")
      .eq("l3_user_id", actor.userId)
      .eq("is_active", true)
    : { data: [], error: null }

  if (accountResult.error && !isAccountManagerSchemaMissing(String(accountResult.error.message ?? ""))) {
    return { rows: [], error: String(accountResult.error.message ?? "No se pudieron cargar las cuentas bajo mando.") }
  }

  const accountRows = extractCatalogRows((accountResult.data ?? []) as AccountManagerRow[])
  if (directResult.error && accountRows.length === 0) {
    const fallback = assignedFallback(actor)
    return fallback.length > 0
      ? { rows: fallback, error: null }
      : { rows: [], error: String(directResult.error.message ?? "No se pudieron cargar los puestos bajo mando.") }
  }

  const directRows = ((directResult.data ?? []) as AuthorizationRow[])
    .filter((row) => isAuthorizationActive(row))
  const rows = [...extractCatalogRows(directRows), ...accountRows]

  const deduped = Array.from(new Map(rows.map((row) => [String(row.id), row])).values())
  return { rows: deduped.length > 0 ? deduped : assignedFallback(actor), error: null }
}