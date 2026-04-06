import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isDirectorMock,
  isManagerMock,
  isOfficerAuthorizedForStationMock,
  loadStationProfilesMock,
  loadStationProfileForStationMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  isManagerMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 3),
  isOfficerAuthorizedForStationMock: vi.fn(),
  loadStationProfilesMock: vi.fn(),
  loadStationProfileForStationMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
  isManager: isManagerMock,
}))

vi.mock("@/lib/station-officer-authorizations", () => ({
  isOfficerAuthorizedForStation: isOfficerAuthorizedForStationMock,
}))

vi.mock("@/lib/station-profiles", () => ({
  loadStationProfiles: loadStationProfilesMock,
  loadStationProfileForStation: loadStationProfileForStationMock,
  isStationProfilesSchemaMissing: (message: string) => String(message ?? "").toLowerCase().includes("station_profiles"),
}))

import { GET, POST } from "@/app/api/station-profiles/route"

type QueryResult = { data?: unknown; error?: { message?: string } | null }

function createAdminStub(resolver: (table: string, state: Record<string, unknown>) => QueryResult) {
  const upserts: Array<{ table: string; values: unknown; options?: unknown }> = []

  return {
    upserts,
    client: {
      from(table: string) {
        const state: Record<string, unknown> = { table }
        const builder = {
          select(fields: string) {
            state.select = fields
            return builder
          },
          eq(column: string, value: unknown) {
            state[`eq:${column}`] = value
            return builder
          },
          limit(value: number) {
            state.limit = value
            return builder
          },
          maybeSingle() {
            const result = resolver(table, state)
            const single = Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null)
            return Promise.resolve({ data: single, error: result.error ?? null })
          },
          then(onFulfilled?: (value: { data: unknown; error: { message?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve({ data: resolver(table, state).data ?? [], error: resolver(table, state).error ?? null }).then(onFulfilled, onRejected)
          },
          upsert(values: unknown, options?: unknown) {
            upserts.push({ table, values, options })
            return Promise.resolve({ error: null })
          },
        }
        return builder
      },
    },
  }
}

describe("/api/station-profiles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns a synthetic fallback profile for the officer base assignment when no explicit authorization exists", async () => {
    const admin = createAdminStub((table) => {
      if (table === "station_officer_authorizations") {
        return { data: [], error: null }
      }

      if (table === "operation_catalog") {
        return {
          data: [{ id: "catalog-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
          error: null,
        }
      }

      return { data: [], error: null }
    })

    loadStationProfilesMock.mockResolvedValue({ ok: true, error: null, records: [] })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l1",
        userId: "local-l1",
        email: "oficial@demo.test",
        firstName: "Oficial",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 1,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/station-profiles?authorized=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.profiles).toEqual([
      expect.objectContaining({
        operationCatalogId: "catalog-1",
        operationName: "BCR",
        postName: "Casa Pavas",
        isEnabled: true,
      }),
    ])
  })

  it("upserts a station profile and reloads the saved record", async () => {
    const admin = createAdminStub((table) => {
      if (table === "operation_catalog") {
        return { data: [{ id: "catalog-1" }], error: null }
      }

      return { data: [], error: null }
    })

    loadStationProfilesMock.mockResolvedValue({
      ok: true,
      error: null,
      records: [{
        id: "profile-1",
        operationCatalogId: "catalog-1",
        operationName: "BCR",
        postName: "Casa Pavas",
        catalogIsActive: true,
        isEnabled: false,
        deviceLabel: "TABLET 7",
        notes: "Bloque norte",
        registeredAt: null,
        updatedAt: null,
      }],
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l4",
        userId: "local-l4",
        email: "director@demo.test",
        firstName: "Directora",
        status: "Activo",
        assigned: null,
        roleLevel: 4,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/station-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationCatalogId: "catalog-1",
        isEnabled: false,
        deviceLabel: " TABLET 7 ",
        notes: " Bloque norte ",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, profile: expect.objectContaining({ id: "profile-1", isEnabled: false }) })
    expect(admin.upserts).toEqual([
      expect.objectContaining({
        table: "station_profiles",
        values: expect.objectContaining({
          operation_catalog_id: "catalog-1",
          is_enabled: false,
          device_label: "TABLET 7",
          notes: "Bloque norte",
        }),
      }),
    ])
  })
})