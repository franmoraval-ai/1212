import { describe, expect, it } from "vitest"
import { loadStationProfileForStation, loadStationProfiles } from "@/lib/station-profiles"
import { createSupabaseAdminStub, getInFilter, type QueryState } from "@/lib/__tests__/supabase-test-helpers"

const station = {
  key: "bcr__casa-pavas",
  label: "Casa Pavas",
  operationName: "BCR",
  postName: "Casa Pavas",
  assignedScope: "BCR | Casa Pavas",
}

function createProfilesAdmin(resolver: (query: QueryState) => { data?: unknown; error?: { message?: string } | null }) {
  return createSupabaseAdminStub(resolver) as never
}

describe("station profiles", () => {
  it("loads and sorts station profiles by operation and post", async () => {
    const admin = createProfilesAdmin((query) => {
      if (query.table === "station_profiles") {
        return {
          data: [
            { id: "profile-2", operation_catalog_id: "catalog-2", is_enabled: false, device_label: "TABLET B", notes: null, registered_at: null, updated_at: null },
            { id: "profile-1", operation_catalog_id: "catalog-1", is_enabled: true, device_label: "TABLET A", notes: "Principal", registered_at: null, updated_at: null },
          ],
        }
      }

      if (query.table === "operation_catalog") {
        return {
          data: [
            { id: "catalog-2", operation_name: "Zeta", client_name: "Puesto Norte", is_active: true },
            { id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
          ],
        }
      }

      return { data: [] }
    })

    const result = await loadStationProfiles(admin)

    expect(result.ok).toBe(true)
    expect(result.records.map((item) => item.operationName)).toEqual(["BCR", "Zeta"])
    expect(result.records[0]).toMatchObject({
      id: "profile-1",
      operationCatalogId: "catalog-1",
      postName: "Casa Pavas",
      isEnabled: true,
    })
  })

  it("resolves a station profile using the exact operation and post match when posts repeat across operations", async () => {
    const admin = createProfilesAdmin((query) => {
      if (query.table === "operation_catalog" && query.limit === 10) {
        return {
          data: [
            { id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
            { id: "catalog-9", operation_name: "OTRA", client_name: "Casa Pavas", is_active: true },
          ],
        }
      }

      if (query.table === "station_profiles") {
        expect(getInFilter(query, "operation_catalog_id")?.values).toEqual(["catalog-1"])
        return {
          data: [
            { id: "profile-1", operation_catalog_id: "catalog-1", is_enabled: true, device_label: "TABLET A", notes: "Principal", registered_at: null, updated_at: null },
          ],
        }
      }

      if (query.table === "operation_catalog") {
        expect(getInFilter(query, "id")?.values).toEqual(["catalog-1"])
        return {
          data: [
            { id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
          ],
        }
      }

      return { data: [] }
    })

    const result = await loadStationProfileForStation(admin, station)

    expect(result.ok).toBe(true)
    expect(result.record).toMatchObject({
      id: "profile-1",
      operationCatalogId: "catalog-1",
      operationName: "BCR",
      postName: "Casa Pavas",
    })
  })

  it("returns null when the post exists in multiple operations and there is no exact operation match", async () => {
    const admin = createProfilesAdmin((query) => {
      if (query.table === "operation_catalog" && query.limit === 10) {
        return {
          data: [
            { id: "catalog-1", operation_name: "OTRA", client_name: "Casa Pavas", is_active: true },
            { id: "catalog-2", operation_name: "SUR", client_name: "Casa Pavas", is_active: true },
          ],
        }
      }

      return { data: [] }
    })

    const result = await loadStationProfileForStation(admin, station)

    expect(result.ok).toBe(true)
    expect(result.record).toBeNull()
  })
})