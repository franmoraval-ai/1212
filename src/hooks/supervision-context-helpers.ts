const SUPERVISION_TIMESTAMP_KEYS = new Set([
  "created_at",
  "updated_at",
  "entry_time",
  "exit_time",
  "last_check",
  "time",
  "timestamp",
  "synced_at",
  "createdAt",
  "updatedAt",
  "entryTime",
  "exitTime",
  "lastCheck",
  "syncedAt",
])

function toDateValue(value: unknown) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  if (value && typeof value === "object" && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const parsed = (value as { toDate: () => Date }).toDate().getTime()
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
  }
  return Number.NEGATIVE_INFINITY
}

export function getSupervisionReportId(row: Record<string, unknown>) {
  const id = String(row.id ?? "").trim()
  return id || ""
}

export function normalizeSupervisionRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    out[camelKey] = value
  }
  return out
}

export function mergeSupervisionReports(
  remoteReports: Record<string, unknown>[],
  optimisticReports: Record<string, unknown>[],
  queuedReports: Record<string, unknown>[]
) {
  const byId = new Map<string, Record<string, unknown>>()
  const withoutId: Record<string, unknown>[] = []

  const append = (rows: Record<string, unknown>[]) => {
    rows.forEach((row) => {
      const id = getSupervisionReportId(row)
      if (!id) {
        withoutId.push(row)
        return
      }
      byId.set(id, row)
    })
  }

  append(optimisticReports)
  append(queuedReports)
  append(remoteReports)

  return [...byId.values(), ...withoutId].sort((left, right) => {
    return toDateValue(right.createdAt) - toDateValue(left.createdAt)
  })
}