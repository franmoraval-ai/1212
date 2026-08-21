import type { ManagedTeamScope } from "@/lib/manager-hierarchy"
import { buildAssignedScope, splitAssignedScope } from "@/lib/personnel-assignment"
import type { AuthenticatedActor } from "@/lib/server-auth"
import { loadCommandOperationCatalog } from "@/lib/station-command-scope"
import { stationMatchesAssigned } from "@/lib/stations"

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

export async function loadActorSupervisionScopes(
  admin: { from: (table: string) => any },
  actor: AuthenticatedActor
) {
  const result = await loadCommandOperationCatalog(admin, actor)
  if (result.error) return []

  return result.rows
    .map((row) => {
      const operationName = normalizeText(row.operation_name)
      const clientName = normalizeText(row.client_name)
      if (!operationName || !clientName) return ""
      return buildAssignedScope(operationName, clientName)
    })
    .filter(Boolean)
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
  _managedTeamScope: ManagedTeamScope,
  row: Record<string, unknown>,
  scopes: string[]
) {
  const roleLevel = Number(actor.roleLevel ?? 0)
  if (roleLevel >= 4) return true

  if (roleLevel === 2) {
    const supervisorId = normalizeText(row.supervisor_id ?? row.supervisorId).toLowerCase()
    return [actor.uid, actor.userId, actor.email]
      .map((value) => normalizeText(value).toLowerCase())
      .filter(Boolean)
      .includes(supervisorId)
  }

  if (roleLevel === 3) return isSupervisionInScope(row, scopes)
  return false
}