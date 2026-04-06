import { canAccessRouteByPermission, isRestrictedMode } from "@/lib/access-control"

type DashboardUserLike = {
  roleLevel?: number | null
  customPermissions?: unknown
} | null | undefined

export function getRestrictedDashboardRoute(permissions: unknown) {
  if (canAccessRouteByPermission("/rounds", permissions)) return "/rounds"
  if (canAccessRouteByPermission("/supervision-agrupada", permissions)) return "/supervision-agrupada"
  if (canAccessRouteByPermission("/personnel", permissions)) return "/personnel"
  return "/login"
}

export function getDefaultDashboardRoute(user: DashboardUserLike) {
  if (!user) return "/login"
  if (isRestrictedMode(user.customPermissions)) {
    return getRestrictedDashboardRoute(user.customPermissions)
  }
  return "/overview"
}