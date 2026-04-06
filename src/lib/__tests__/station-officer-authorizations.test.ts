import { describe, expect, it } from "vitest"
import { isOfficerAuthorizedForStation, loadAuthorizedOfficersForStation } from "@/lib/station-officer-authorizations"
import { createSupabaseAdminStub, getEqFilter, type QueryState } from "@/lib/__tests__/supabase-test-helpers"

const station = {
  key: "bcr__casa-pavas",
  label: "Casa Pavas",
  operationName: "BCR",
  postName: "Casa Pavas",
  assignedScope: "BCR | Casa Pavas",
}

function createAuthorizationAdmin(resolver: (query: QueryState) => { data?: unknown; error?: { message?: string } | null }) {
  return createSupabaseAdminStub(resolver) as never
}

describe("station officer authorizations", () => {
  it("authorizes an officer from explicit active catalog authorization", async () => {
    const admin = createAuthorizationAdmin((query) => {
      if (query.table === "operation_catalog") {
        return {
          data: [{ id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
        }
      }

      if (query.table === "station_officer_authorizations") {
        expect(getEqFilter(query, "operation_catalog_id")?.value).toBe("catalog-1")
        expect(getEqFilter(query, "officer_user_id")?.value).toBe("officer-1")
        return {
          data: [{ officer_user_id: "officer-1", is_active: true, valid_from: null, valid_to: null }],
        }
      }

      return { data: [] }
    })

    const result = await isOfficerAuthorizedForStation(admin, "officer-1", station)

    expect(result.ok).toBe(true)
    expect(result.isAuthorized).toBe(true)
    expect(result.source).toBe("catalog")
    expect(result.operationCatalogId).toBe("catalog-1")
  })

  it("falls back to base assigned scope when no explicit authorization exists", async () => {
    const admin = createAuthorizationAdmin((query) => {
      if (query.table === "operation_catalog") {
        return {
          data: [{ id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
        }
      }

      if (query.table === "station_officer_authorizations") {
        return { data: [] }
      }

      if (query.table === "users") {
        return {
          data: [{
            id: "officer-2",
            email: "oficial@demo.test",
            first_name: "Oficial Base",
            role_level: 1,
            status: "Activo",
            assigned: "BCR | Casa Pavas",
          }],
        }
      }

      return { data: [] }
    })

    const result = await isOfficerAuthorizedForStation(admin, "officer-2", station)

    expect(result.ok).toBe(true)
    expect(result.isAuthorized).toBe(true)
    expect(result.source).toBe("base-assigned")
  })

  it("returns schema-missing when the authorization table is unavailable", async () => {
    const admin = createAuthorizationAdmin((query) => {
      if (query.table === "operation_catalog") {
        return {
          data: [{ id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
        }
      }

      if (query.table === "station_officer_authorizations") {
        return {
          error: { message: 'relation "station_officer_authorizations" does not exist' },
        }
      }

      return { data: [] }
    })

    const result = await isOfficerAuthorizedForStation(admin, "officer-3", station)

    expect(result.ok).toBe(false)
    expect(result.isAuthorized).toBe(false)
    expect(result.source).toBe("schema-missing")
  })

  it("loads fallback officers from assigned base when a post has no explicit authorization rows", async () => {
    const admin = createAuthorizationAdmin((query) => {
      if (query.table === "users") {
        const roleLevelFilter = getEqFilter(query, "role_level")
        if (roleLevelFilter?.value === 1) {
          return {
            data: [
              {
                id: "officer-1",
                email: "uno@demo.test",
                first_name: "Uno",
                role_level: 1,
                status: "Activo",
                assigned: "BCR | Casa Pavas",
              },
              {
                id: "officer-2",
                email: "dos@demo.test",
                first_name: "Dos",
                role_level: 1,
                status: "Activo",
                assigned: "BCR | Casa Matriz",
              },
            ],
          }
        }
      }

      if (query.table === "operation_catalog") {
        return {
          data: [{ id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
        }
      }

      if (query.table === "station_officer_authorizations") {
        return { data: [] }
      }

      return { data: [] }
    })

    const result = await loadAuthorizedOfficersForStation(admin, station, station.postName)

    expect(result.error).toBeNull()
    expect(result.source).toBe("base-assigned")
    expect(result.rows).toHaveLength(1)
    expect(result.rows?.[0]).toMatchObject({
      id: "officer-1",
      authorizationSource: "base-assigned",
      isAssignedHere: true,
    })
  })
})