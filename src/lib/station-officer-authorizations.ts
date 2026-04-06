import type { SupabaseClient } from "@supabase/supabase-js"
import { stationMatchesAssigned, type StationReference } from "@/lib/stations"

type OfficerUserRow = {
  id: string
  email?: string | null
  first_name?: string | null
  role_level?: number | null
  status?: string | null
  assigned?: string | null
}

type OperationCatalogRow = {
  id: string
  operation_name?: string | null
  client_name?: string | null
  is_active?: boolean | null
}

type StationOfficerAuthorizationRow = {
  officer_user_id?: string | null
  is_active?: boolean | null
  valid_from?: string | null
  valid_to?: string | null
}

export type AuthorizedStationOfficer = {
  id: string
  name: string
  email: string
  assigned: string
  status: string
  isAssignedHere: boolean
  authorizationSource: "catalog" | "base-assigned"
}

function normalizeStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function isActiveOfficer(row: OfficerUserRow) {
  return ["", "activo", "active"].includes(normalizeStatus(row.status))
}

function mapOfficerRow(row: OfficerUserRow, stationLabel: string, authorizationSource: "catalog" | "base-assigned") {
  const assigned = String(row.assigned ?? "").trim()
  const isAssignedHere = stationMatchesAssigned(stationLabel, assigned)
  const name = String(row.first_name ?? row.email ?? "Oficial").trim() || "Oficial"

  return {
    id: String(row.id),
    name,
    email: String(row.email ?? "").trim().toLowerCase(),
    assigned,
    status: String(row.status ?? "").trim(),
    isAssignedHere,
    authorizationSource,
  } satisfies AuthorizedStationOfficer
}

function loadAssignedFallbackOfficers(rows: OfficerUserRow[], stationLabel: string) {
  return rows
    .filter((row) => stationMatchesAssigned(stationLabel, row.assigned))
    .map((row) => mapOfficerRow(row, stationLabel, "base-assigned"))
}

function isMissingAuthorizationTableError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("station_officer_authorizations") || normalized.includes("operation_catalog")
}

function isAuthorizationWindowActive(row: StationOfficerAuthorizationRow, now = Date.now()) {
  if (row.is_active === false) return false

  const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null
  const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null

  if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
  if (validTo && Number.isFinite(validTo) && validTo < now) return false
  return true
}

async function loadActiveL1Officers(admin: SupabaseClient) {
  const { data, error } = await admin
    .from("users")
    .select("id,email,first_name,role_level,status,assigned")
    .eq("role_level", 1)

  if (error) return { rows: null, error }

  return {
    rows: ((data ?? []) as OfficerUserRow[])
      .filter(isActiveOfficer)
      .sort((left, right) => {
        const leftName = String(left.first_name ?? left.email ?? "Oficial")
        const rightName = String(right.first_name ?? right.email ?? "Oficial")
        return leftName.localeCompare(rightName, "es", { sensitivity: "base" })
      }),
    error: null,
  }
}

async function resolveCatalogPost(admin: SupabaseClient, station: StationReference) {
  const postName = String(station.postName ?? "").trim()
  const operationName = String(station.operationName ?? "").trim()
  if (!postName) return { row: null, error: null, ambiguous: false }

  if (operationName && operationName.toLowerCase() !== postName.toLowerCase()) {
    const exact = await admin
      .from("operation_catalog")
      .select("id,operation_name,client_name,is_active")
      .eq("operation_name", operationName)
      .eq("client_name", postName)
      .eq("is_active", true)
      .limit(2)

    if (exact.error) return { row: null, error: exact.error, ambiguous: false }
    if ((exact.data ?? []).length === 1) {
      return { row: ((exact.data ?? [])[0] as OperationCatalogRow) ?? null, error: null, ambiguous: false }
    }
  }

  const byPost = await admin
    .from("operation_catalog")
    .select("id,operation_name,client_name,is_active")
    .eq("client_name", postName)
    .eq("is_active", true)
    .limit(2)

  if (byPost.error) return { row: null, error: byPost.error, ambiguous: false }
  if ((byPost.data ?? []).length > 1) return { row: null, error: null, ambiguous: true }
  return { row: ((byPost.data ?? [])[0] as OperationCatalogRow) ?? null, error: null, ambiguous: false }
}

export async function isOfficerAuthorizedForStation(admin: SupabaseClient, officerUserId: string, station: StationReference) {
  const normalizedOfficerUserId = String(officerUserId ?? "").trim()
  if (!normalizedOfficerUserId) {
    return { ok: false as const, error: "Falta officerUserId.", isAuthorized: false, source: "error" as const }
  }

  const catalogPost = await resolveCatalogPost(admin, station)
  if (catalogPost.error) {
    const message = String(catalogPost.error.message ?? "")
    if (isMissingAuthorizationTableError(message)) {
      return { ok: false as const, error: message, isAuthorized: false, source: "schema-missing" as const }
    }
    return { ok: false as const, error: catalogPost.error.message, isAuthorized: false, source: "error" as const }
  }

  if (!catalogPost.row || catalogPost.ambiguous) {
    return { ok: true as const, error: null, isAuthorized: false, source: "catalog" as const, operationCatalogId: null }
  }

  const authorizations = await admin
    .from("station_officer_authorizations")
    .select("officer_user_id,is_active,valid_from,valid_to")
    .eq("operation_catalog_id", catalogPost.row.id)
    .eq("officer_user_id", normalizedOfficerUserId)

  if (authorizations.error) {
    const message = String(authorizations.error.message ?? "")
    if (isMissingAuthorizationTableError(message)) {
      return { ok: false as const, error: message, isAuthorized: false, source: "schema-missing" as const }
    }
    return { ok: false as const, error: authorizations.error.message, isAuthorized: false, source: "error" as const }
  }

  const authorizationRows = (authorizations.data ?? []) as StationOfficerAuthorizationRow[]
  if (authorizationRows.length > 0) {
    return {
      ok: true as const,
      error: null,
      isAuthorized: authorizationRows.some((row) => isAuthorizationWindowActive(row)),
      source: "catalog" as const,
      operationCatalogId: String(catalogPost.row.id ?? "").trim() || null,
    }
  }

  const { data: officer, error: officerError } = await admin
    .from("users")
    .select("id,email,first_name,role_level,status,assigned")
    .eq("id", normalizedOfficerUserId)
    .maybeSingle()

  if (officerError) {
    return { ok: false as const, error: officerError.message, isAuthorized: false, source: "error" as const }
  }

  const fallbackAuthorized = Boolean(
    officer
    && Number(officer.role_level ?? 1) === 1
    && isActiveOfficer(officer as OfficerUserRow)
    && stationMatchesAssigned(catalogPost.row.client_name ?? station.postName ?? station.label, officer.assigned)
  )

  return {
    ok: true as const,
    error: null,
    isAuthorized: fallbackAuthorized,
    source: fallbackAuthorized ? "base-assigned" as const : "catalog" as const,
    operationCatalogId: String(catalogPost.row.id ?? "").trim() || null,
  }
}

export async function loadAuthorizedOfficersForStation(admin: SupabaseClient, station: StationReference, stationLabel: string) {
  const officers = await loadActiveL1Officers(admin)
  if (officers.error || !officers.rows) {
    return { rows: null, error: officers.error, source: "error" as const }
  }

  const catalogPost = await resolveCatalogPost(admin, station)
  if (catalogPost.error) {
    const message = String(catalogPost.error.message ?? "")
    if (isMissingAuthorizationTableError(message)) {
      return { rows: null, error: catalogPost.error, source: "schema-missing" as const }
    }
    return { rows: null, error: catalogPost.error, source: "error" as const }
  }

  if (!catalogPost.row || catalogPost.ambiguous) {
    return { rows: [], error: null, source: "catalog" as const }
  }

  const authorizations = await admin
    .from("station_officer_authorizations")
    .select("officer_user_id,is_active,valid_from,valid_to")
    .eq("operation_catalog_id", catalogPost.row.id)

  if (authorizations.error) {
    const message = String(authorizations.error.message ?? "")
    if (isMissingAuthorizationTableError(message)) {
      return { rows: null, error: authorizations.error, source: "schema-missing" as const }
    }
    return { rows: null, error: authorizations.error, source: "error" as const }
  }

  const authorizedIds = new Set(
    ((authorizations.data ?? []) as StationOfficerAuthorizationRow[])
      .filter((row) => isAuthorizationWindowActive(row))
      .map((row) => String(row.officer_user_id ?? "").trim())
      .filter(Boolean)
  )

  if (((authorizations.data ?? []) as StationOfficerAuthorizationRow[]).length === 0) {
    return {
      rows: loadAssignedFallbackOfficers(officers.rows, stationLabel),
      error: null,
      source: "base-assigned" as const,
    }
  }

  return {
    rows: officers.rows
      .filter((row) => authorizedIds.has(String(row.id ?? "").trim()))
      .map((row) => mapOfficerRow(row, stationLabel, "catalog")),
    error: null,
    source: "catalog" as const,
  }
}