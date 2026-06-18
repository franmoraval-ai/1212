import type { AuthenticatedActor } from "@/lib/server-auth"

type ManagedUserRow = {
  id?: string | null
  email?: string | null
  status?: string | null
  role_level?: number | null
}

export type ManagedTeamScope = {
  userIds: Set<string>
  emails: Set<string>
}

export function isManagerHierarchySchemaMissing(message: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("manager_user_id") && (normalized.includes("does not exist") || normalized.includes("column"))
}

function normalizeIdentity(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function isActiveStatus(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "activo" || normalized === "active"
}

export function createEmptyManagedTeamScope(): ManagedTeamScope {
  return {
    userIds: new Set<string>(),
    emails: new Set<string>(),
  }
}

export async function loadManagedTeamScope(
  admin: { from: (table: string) => any },
  actor: Pick<AuthenticatedActor, "roleLevel" | "userId">
) {
  const emptyScope = createEmptyManagedTeamScope()
  if (Number(actor.roleLevel ?? 0) < 3) {
    return { scope: emptyScope, error: null as string | null }
  }

  const managerUserId = String(actor.userId ?? "").trim()
  if (!managerUserId) {
    return { scope: emptyScope, error: null as string | null }
  }

  const { data, error } = await admin
    .from("users")
    .select("id,email,status,role_level")
    .eq("manager_user_id", managerUserId)

  if (error) {
    if (isManagerHierarchySchemaMissing(String(error.message ?? ""))) {
      return { scope: emptyScope, error: null as string | null }
    }

    return {
      scope: emptyScope,
      error: String(error.message ?? "No se pudo cargar el equipo a cargo."),
    }
  }

  const scope = createEmptyManagedTeamScope()
  for (const row of (Array.isArray(data) ? data : []) as ManagedUserRow[]) {
    if (!isActiveStatus(row.status)) continue
    if (![1, 3].includes(Number(row.role_level ?? 0))) continue

    const userId = normalizeIdentity(row.id)
    const email = normalizeIdentity(row.email)
    if (userId) scope.userIds.add(userId)
    if (email) scope.emails.add(email)
  }

  return { scope, error: null as string | null }
}

export function matchesActorOrManagedIdentity(
  actor: Pick<AuthenticatedActor, "uid" | "userId" | "email">,
  scope: ManagedTeamScope,
  identity: unknown
) {
  const normalized = normalizeIdentity(identity)
  if (!normalized) return false

  return (
    normalized === normalizeIdentity(actor.uid) ||
    normalized === normalizeIdentity(actor.userId) ||
    normalized === normalizeIdentity(actor.email) ||
    scope.userIds.has(normalized) ||
    scope.emails.has(normalized)
  )
}

export function matchesActorOrManagedUser(
  actor: Pick<AuthenticatedActor, "uid" | "userId" | "email">,
  scope: ManagedTeamScope,
  options: { userId?: unknown; email?: unknown }
) {
  return matchesActorOrManagedIdentity(actor, scope, options.userId) || matchesActorOrManagedIdentity(actor, scope, options.email)
}