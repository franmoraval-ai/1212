import { matchesActorOrManagedIdentity, type ManagedTeamScope } from "@/lib/manager-hierarchy"
import { buildAssignedScope, splitAssignedScope } from "@/lib/personnel-assignment"
import type { AuthenticatedActor } from "@/lib/server-auth"
import { stationMatchesAssigned } from "@/lib/stations"

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function isWindowActive(validFrom: unknown, validTo: unknown, now = Date.now()) {
  const from = validFrom ? new Date(String(validFrom)).getTime() : null
  const to = validTo ? new Date(String(validTo)).getTime() : null
  if (from && Number.isFinite(from) && from > now) return false
  if (to && Number.isFinite(to) && to < now) return false
  return true
}

export async function loadActorSupervisionScopes(
  admin: { from: (table: string) => any },
  actor: Pick<AuthenticatedActor, "userId" | "assigned">
) {
  const result = await admin
    .from("station_officer_authorizations")
    .select("is_active,valid_from,valid_to,operation_catalog:operation_catalog_id(operation_name,client_name)")
    .eq("officer_user_id", actor.userId)
    .eq("is_active", true)

  if (result.error) {
    const fallback = normalizeText(actor.assigned)
    return fallback ? [fallback] : []
  }

  const scopes = ((result.data ?? []) as Array<Record<string, unknown>>)
    .filter((row) => isWindowActive(row.valid_from, row.valid_to))
    .map((row) => {
      const catalog = Array.isArray(row.operation_catalog)
        ? (row.operation_catalog[0] as Record<string, unknown> | undefined)
        : (row.operation_catalog as Record<string, unknown> | null)
      const operationName = normalizeText(catalog?.operation_name)
      const clientName = normalizeText(catalog?.client_name)
      if (!operationName || !clientName) return ""
      return buildAssignedScope(operationName, clientName)
    })
    .filter(Boolean)

  if (scopes.length > 0) return scopes
  const fallback = normalizeText(actor.assigned)
  return fallback ? [fallback] : []
}

export function isSupervisionInScope(row: Record<string, unknown>, scopes: string[]) {
  if (scopes.length === 0) return false

  const operation = normalizeText(row.operation_name ?? row.operationName)
  const post = normalizeText(row.review_post ?? row.reviewPost)
  const client = normalizeText(row.client_name ?? row.clientName)

  return scopes.some((scope) => {
    const { operationName, postName } = splitAssignedScope(scope)
    return (
      stationMatchesAssigned(post, scope)
      || stationMatchesAssigned(operation, scope)
      || (client ? stationMatchesAssigned(client, scope) : false)
      || (operationName && postName && normalizeText(operation).toLowerCase() === operationName.toLowerCase() && normalizeText(post).toLowerCase() === postName.toLowerCase())
    )
  })
}

export function canViewSupervisionRecord(
  actor: Pick<AuthenticatedActor, "uid" | "userId" | "email" | "roleLevel">,
  managedTeamScope: ManagedTeamScope,
  row: Record<string, unknown>,
  scopes: string[]
) {
  if (Number(actor.roleLevel ?? 0) >= 4) return true
  if (matchesActorOrManagedIdentity(actor, managedTeamScope, row.supervisor_id ?? row.supervisorId)) return true
  return isSupervisionInScope(row, scopes)
}