import type { SupabaseClient } from "@supabase/supabase-js"
import type { StationReference } from "@/lib/stations"

export type StationProfileRecord = {
  id: string
  operationCatalogId: string
  operationName: string
  postName: string
  catalogIsActive: boolean
  isEnabled: boolean
  deviceLabel: string | null
  notes: string | null
  registeredAt: string | null
  updatedAt: string | null
}

type StationProfileRow = {
  id?: string | null
  operation_catalog_id?: string | null
  is_enabled?: boolean | null
  device_label?: string | null
  notes?: string | null
  registered_at?: string | null
  updated_at?: string | null
}

type OperationCatalogRow = {
  id?: string | null
  operation_name?: string | null
  client_name?: string | null
  is_active?: boolean | null
}

function isExactStationCatalogMatch(row: OperationCatalogRow, station: StationReference) {
  const operationName = String(row.operation_name ?? "").trim().toLowerCase()
  const postName = String(row.client_name ?? "").trim().toLowerCase()
  return operationName === String(station.operationName ?? "").trim().toLowerCase()
    && postName === String(station.postName ?? "").trim().toLowerCase()
}

async function resolveOperationCatalogIdForStation(admin: SupabaseClient, station: StationReference) {
  const postName = String(station.postName ?? "").trim()
  const operationName = String(station.operationName ?? "").trim()
  if (!postName) {
    return { ok: true as const, error: null, operationCatalogId: null }
  }

  const { data, error } = await admin
    .from("operation_catalog")
    .select("id,operation_name,client_name,is_active")
    .eq("client_name", postName)
    .eq("is_active", true)
    .limit(10)

  if (error) {
    return { ok: false as const, error: error.message, operationCatalogId: null }
  }

  const rows = (data ?? []) as OperationCatalogRow[]
  if (rows.length === 0) {
    return { ok: true as const, error: null, operationCatalogId: null }
  }

  const exactMatch = rows.find((row) => isExactStationCatalogMatch(row, station))
  if (exactMatch?.id) {
    return { ok: true as const, error: null, operationCatalogId: String(exactMatch.id).trim() }
  }

  if (rows.length === 1 && rows[0]?.id) {
    return { ok: true as const, error: null, operationCatalogId: String(rows[0].id).trim() }
  }

  return { ok: true as const, error: null, operationCatalogId: null }
}

export function isStationProfilesSchemaMissing(message: string) {
  return String(message ?? "").toLowerCase().includes("station_profiles")
}

export async function loadStationProfiles(admin: SupabaseClient, operationCatalogIds?: string[]) {
  let profilesQuery = admin
    .from("station_profiles")
    .select("id,operation_catalog_id,is_enabled,device_label,notes,registered_at,updated_at")

  let operationsQuery = admin
    .from("operation_catalog")
    .select("id,operation_name,client_name,is_active")

  if (operationCatalogIds && operationCatalogIds.length > 0) {
    profilesQuery = profilesQuery.in("operation_catalog_id", operationCatalogIds)
    operationsQuery = operationsQuery.in("id", operationCatalogIds)
  }

  const [{ data: profiles, error: profilesError }, { data: operations, error: operationsError }] = await Promise.all([
    profilesQuery,
    operationsQuery,
  ])

  if (profilesError) {
    return { ok: false as const, error: profilesError.message, records: [] as StationProfileRecord[] }
  }

  if (operationsError) {
    return { ok: false as const, error: operationsError.message, records: [] as StationProfileRecord[] }
  }

  const operationsMap = new Map<string, OperationCatalogRow>()
  for (const row of (operations ?? []) as OperationCatalogRow[]) {
    const id = String(row.id ?? "").trim()
    if (!id) continue
    operationsMap.set(id, row)
  }

  const records = ((profiles ?? []) as StationProfileRow[])
    .map((row) => {
      const operationCatalogId = String(row.operation_catalog_id ?? "").trim()
      if (!operationCatalogId) return null
      const operation = operationsMap.get(operationCatalogId)
      return {
        id: String(row.id ?? "").trim(),
        operationCatalogId,
        operationName: String(operation?.operation_name ?? "").trim(),
        postName: String(operation?.client_name ?? "").trim(),
        catalogIsActive: operation?.is_active !== false,
        isEnabled: row.is_enabled !== false,
        deviceLabel: row.device_label ?? null,
        notes: row.notes ?? null,
        registeredAt: row.registered_at ?? null,
        updatedAt: row.updated_at ?? null,
      } satisfies StationProfileRecord
    })
    .filter((value): value is StationProfileRecord => value !== null)
    .sort((left, right) => {
      const byOperation = left.operationName.localeCompare(right.operationName, "es", { sensitivity: "base" })
      if (byOperation !== 0) return byOperation
      return left.postName.localeCompare(right.postName, "es", { sensitivity: "base" })
    })

  return { ok: true as const, error: null, records }
}

export async function loadStationProfileForStation(admin: SupabaseClient, station: StationReference) {
  const catalogResolution = await resolveOperationCatalogIdForStation(admin, station)
  if (!catalogResolution.ok) {
    return { ok: false as const, error: catalogResolution.error, record: null as StationProfileRecord | null }
  }

  if (!catalogResolution.operationCatalogId) {
    return { ok: true as const, error: null, record: null as StationProfileRecord | null }
  }

  const result = await loadStationProfiles(admin, [catalogResolution.operationCatalogId])
  if (!result.ok) {
    return { ok: false as const, error: result.error, record: null as StationProfileRecord | null }
  }

  return { ok: true as const, error: null, record: result.records[0] ?? null }
}
