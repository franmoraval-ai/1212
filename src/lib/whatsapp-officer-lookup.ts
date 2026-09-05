import type { SupabaseClient } from "@supabase/supabase-js"
import { loadAuthorizedOfficersForStation, type AuthorizedStationOfficer } from "@/lib/station-officer-authorizations"
import type { StationReference } from "@/lib/stations"

export type OfficerLookupResult =
  | { ok: true; officer: AuthorizedStationOfficer }
  | {
      ok: false
      reason: "schema-missing" | "station-not-found" | "not-found" | "ambiguous" | "error"
      error?: string
      candidates?: string[]
    }

function normalizeQuery(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

function normalizeIdNumber(value: unknown) {
  return normalizeQuery(value).replace(/[^a-z0-9]/g, "")
}

// Resolves a free-text WhatsApp message field (name or cedula) to an officer authorized for the given station.
export async function findAuthorizedOfficerForStation(
  admin: SupabaseClient,
  station: StationReference,
  officerQuery: string,
  officerIdNumber?: string
): Promise<OfficerLookupResult> {
  const officers = await loadAuthorizedOfficersForStation(admin, station, station.label)

  if (officers.source === "schema-missing") {
    return { ok: false, reason: "schema-missing" }
  }
  if (officers.error || !officers.rows) {
    return { ok: false, reason: "error", error: officers.error?.message }
  }
  if (officers.rows.length === 0) {
    return { ok: false, reason: "station-not-found" }
  }

  // An explicit cedula field, when provided, is unambiguous and takes priority over name matching.
  const normalizedIdNumber = normalizeQuery(officerIdNumber)
  if (normalizedIdNumber) {
    const explicitIdMatch = await findByIdNumber(admin, officers.rows, normalizedIdNumber)
    if (explicitIdMatch) return { ok: true, officer: explicitIdMatch }
  }

  const normalizedQuery = normalizeQuery(officerQuery)
  if (!normalizedQuery) return { ok: false, reason: "not-found" }

  const idNumberMatch = await findByIdNumber(admin, officers.rows, normalizedQuery)
  if (idNumberMatch) return { ok: true, officer: idNumberMatch }

  const exact = officers.rows.filter((row) => normalizeQuery(row.name) === normalizedQuery)
  if (exact.length === 1) return { ok: true, officer: exact[0] }
  if (exact.length > 1) return { ok: false, reason: "ambiguous", candidates: exact.map((row) => row.name) }

  const partial = officers.rows.filter((row) => {
    const name = normalizeQuery(row.name)
    return name.includes(normalizedQuery) || normalizedQuery.includes(name)
  })
  if (partial.length === 1) return { ok: true, officer: partial[0] }
  if (partial.length > 1) return { ok: false, reason: "ambiguous", candidates: partial.map((row) => row.name) }

  return { ok: false, reason: "not-found" }
}

async function findByIdNumber(admin: SupabaseClient, officers: AuthorizedStationOfficer[], normalizedQuery: string) {
  const normalizedId = normalizeIdNumber(normalizedQuery)
  if (normalizedId.length < 4) return null

  // Cedula lives in personnel_registry (users.id_number is not a live column); linked_user_id maps back to users.id.
  const { data, error } = await admin
    .from("personnel_registry")
    .select("linked_user_id,id_number")
    .in("linked_user_id", officers.map((row) => row.id))

  if (error || !data) return null

  const match = (data as { linked_user_id: string; id_number?: string | null }[]).find(
    (row) => normalizeIdNumber(row.id_number) === normalizedId
  )
  if (!match) return null

  return officers.find((row) => row.id === match.linked_user_id) ?? null
}
