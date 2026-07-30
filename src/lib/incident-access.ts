import { matchesActorOrManagedUser } from "@/lib/manager-hierarchy"
import { stationMatchesAssigned } from "@/lib/stations"

export type IncidentAccessRow = {
  location?: string | null
  lugar?: string | null
  reported_by_user_id?: string | null
  reported_by_email?: string | null
}

export function canManageIncident(
  actor: { uid: string; email: string; assigned?: string | null; roleLevel: number },
  incident: IncidentAccessRow
) {
  const roleLevel = Number(actor.roleLevel ?? 1)
  if (roleLevel >= 3) return true
  if (roleLevel < 2) return false

  const userId = String(actor.uid ?? "").trim()
  const email = String(actor.email ?? "").trim().toLowerCase()
  const reportedByUserId = String(incident.reported_by_user_id ?? "").trim()
  const reportedByEmail = String(incident.reported_by_email ?? "").trim().toLowerCase()

  if (userId && reportedByUserId && reportedByUserId === userId) return true
  if (email && reportedByEmail && reportedByEmail === email) return true

  const assigned = String(actor.assigned ?? "").trim()
  return stationMatchesAssigned(incident.location, assigned) || stationMatchesAssigned(incident.lugar, assigned)
}

export function canViewIncident(
  actor: { uid: string; userId: string; email: string; assigned?: string | null; roleLevel: number },
  managedTeamScope: { userIds: Set<string>; emails: Set<string> },
  incident: IncidentAccessRow
) {
  const roleLevel = Number(actor.roleLevel ?? 1)
  if (roleLevel >= 4) return true

  const ownOrManaged = matchesActorOrManagedUser(actor, managedTeamScope, {
    userId: incident.reported_by_user_id,
    email: incident.reported_by_email,
  })

  if (roleLevel <= 1) return ownOrManaged
  if (ownOrManaged) return true

  return stationMatchesAssigned(incident.location, actor.assigned) || stationMatchesAssigned(incident.lugar, actor.assigned)
}