export type CustomPermission =
  | "restricted_access"
  | "personnel_view"
  | "personnel_create"
  | "supervision_grouped_view"
  | "rounds_access"
  | "data_ops_manage"

const ROUTE_PERMISSION_RULES: Array<{ prefix: string; permission: CustomPermission }> = [
  { prefix: "/personnel", permission: "personnel_view" },
  { prefix: "/supervision-agrupada", permission: "supervision_grouped_view" },
  { prefix: "/rounds", permission: "rounds_access" },
  { prefix: "/data-center", permission: "data_ops_manage" },
]

export function normalizePermissions(value: unknown): CustomPermission[] {
  if (!Array.isArray(value)) return []
  const normalized = value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean) as CustomPermission[]
  return Array.from(new Set(normalized))
}

export function hasPermission(permissionList: unknown, permission: CustomPermission): boolean {
  return normalizePermissions(permissionList).includes(permission)
}

export function isRestrictedMode(permissionList: unknown): boolean {
  return hasPermission(permissionList, "restricted_access")
}

export function canAccessRouteByPermission(pathname: string, permissionList: unknown): boolean {
  const match = ROUTE_PERMISSION_RULES.find((item) => pathname.startsWith(item.prefix))
  if (!match) return false
  return hasPermission(permissionList, match.permission)
}
