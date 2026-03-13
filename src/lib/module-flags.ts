type BoolLike = string | undefined

function envEnabled(value: BoolLike, fallback: boolean) {
  if (value == null) return fallback
  const normalized = value.trim().toLowerCase()
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false
  return fallback
}

export const moduleFlags = {
  overview: envEnabled(process.env.NEXT_PUBLIC_ENABLE_OVERVIEW, true),
  visitors: envEnabled(process.env.NEXT_PUBLIC_ENABLE_VISITORS, false),
  map: envEnabled(process.env.NEXT_PUBLIC_ENABLE_MAP, false),
  rounds: envEnabled(process.env.NEXT_PUBLIC_ENABLE_ROUNDS, true),
  supervision: envEnabled(process.env.NEXT_PUBLIC_ENABLE_SUPERVISION, true),
  supervisionGrouped: envEnabled(process.env.NEXT_PUBLIC_ENABLE_SUPERVISION_GROUPED, true),
  incidents: envEnabled(process.env.NEXT_PUBLIC_ENABLE_INCIDENTS, true),
  internalNotes: envEnabled(process.env.NEXT_PUBLIC_ENABLE_INTERNAL_NOTES, true),
  operations: envEnabled(process.env.NEXT_PUBLIC_ENABLE_OPERATIONS, true),
  weapons: envEnabled(process.env.NEXT_PUBLIC_ENABLE_WEAPONS, true),
  managementAudit: envEnabled(process.env.NEXT_PUBLIC_ENABLE_MANAGEMENT_AUDIT, false),
  personnel: envEnabled(process.env.NEXT_PUBLIC_ENABLE_PERSONNEL, true),
}
