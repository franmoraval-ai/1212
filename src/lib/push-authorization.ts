import type { AuthenticatedActor } from "@/lib/server-auth"
import type { ManagedTeamScope } from "@/lib/manager-hierarchy"
import { matchesActorOrManagedUser } from "@/lib/manager-hierarchy"
import { stationMatchesAssigned } from "@/lib/stations"

export type AlertTarget = {
  id: string
  email: string
  assigned?: string | null
}

/**
 * ¿Puede `actor` enviar una alerta push a `target`?
 * - L4: cualquier usuario.
 * - L3: solo usuarios de su equipo (jerarquía manager_user_id).
 * - L2: solo oficiales de su misma estación/puesto asignado.
 * - L1: nadie.
 */
export function canAlertOfficer(
  actor: Pick<AuthenticatedActor, "uid" | "userId" | "email" | "roleLevel" | "assigned">,
  managedTeamScope: ManagedTeamScope,
  target: AlertTarget
): boolean {
  const roleLevel = Number(actor.roleLevel ?? 1)

  if (roleLevel >= 4) return true

  if (roleLevel === 3) {
    return matchesActorOrManagedUser(actor, managedTeamScope, {
      userId: target.id,
      email: target.email,
    })
  }

  if (roleLevel === 2) {
    return stationMatchesAssigned(target.assigned, actor.assigned)
  }

  return false
}
