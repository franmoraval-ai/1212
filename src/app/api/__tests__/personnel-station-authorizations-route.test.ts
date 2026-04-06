import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

import { GET, POST } from "@/app/api/personnel/station-authorizations/route"

type QueryResult = { data?: unknown; error?: { message?: string } | null }
type RecordedCall = {
  type: "upsert" | "update"
  table: string
  values: unknown
  options?: unknown
  filters?: Record<string, unknown>
}

function createAdminStub(resolver: (table: string, state: Record<string, unknown>) => QueryResult) {
  const recorded: RecordedCall[] = []

  return {
    recorded,
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
          in(column: string, value: unknown[]) {
            state[`in:${column}`] = value
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
            recorded.push({ type: "upsert", table, values, options })
            return Promise.resolve({ error: null })
          },
          update(values: unknown) {
            state.update = values
            const updateBuilder = {
              eq(column: string, value: unknown) {
                state[`eq:${column}`] = value
                return updateBuilder
              },
              in(column: string, value: unknown[]) {
                state[`in:${column}`] = value
                recorded.push({ type: "update", table, values, filters: { ...state } })
                return Promise.resolve({ error: null })
              },
            }
            return updateBuilder
          },
        }
        return builder
      },
    },
  }
}

describe("/api/personnel/station-authorizations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns only active and currently valid operation ids on GET", async () => {
    const admin = createAdminStub((table) => {
      if (table === "users") {
        return { data: [{ id: "officer-1", role_level: 1 }], error: null }
      }

      if (table === "station_officer_authorizations") {
        return {
          data: [
            { operation_catalog_id: "catalog-1", is_active: true, valid_from: null, valid_to: null },
            { operation_catalog_id: "catalog-1", is_active: true, valid_from: null, valid_to: null },
            { operation_catalog_id: "catalog-2", is_active: true, valid_from: "2026-03-31T10:00:00.000Z", valid_to: null },
            { operation_catalog_id: "catalog-3", is_active: false, valid_from: null, valid_to: null },
            { operation_catalog_id: "catalog-4", is_active: true, valid_from: "2026-05-01T10:00:00.000Z", valid_to: null },
            { operation_catalog_id: "catalog-5", is_active: true, valid_from: null, valid_to: "2026-03-01T10:00:00.000Z" },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
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

    const response = await GET(new Request("http://localhost/api/personnel/station-authorizations?userId=officer-1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.operationCatalogIds).toEqual(["catalog-1", "catalog-2"])
  })

  it("uses actor.userId when saving and revoking officer posts", async () => {
    const admin = createAdminStub((table, state) => {
      if (table === "users") {
        return { data: [{ id: "officer-1", role_level: 1 }], error: null }
      }

      if (table === "operation_catalog") {
        return { data: [{ id: "catalog-1" }], error: null }
      }

      if (table === "station_officer_authorizations" && state.select) {
        return {
          data: [
            { id: "auth-1", operation_catalog_id: "catalog-1", is_active: true },
            { id: "auth-2", operation_catalog_id: "catalog-2", is_active: true },
          ],
          error: null,
        }
      }

      return { data: [], error: null }
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

    const response = await POST(new Request("http://localhost/api/personnel/station-authorizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: "officer-1",
        operationCatalogIds: ["catalog-1"],
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, authorizedCount: 1 })

    const upsertCall = admin.recorded.find((entry) => entry.type === "upsert")
    expect(upsertCall?.values).toEqual([
      expect.objectContaining({
        operation_catalog_id: "catalog-1",
        officer_user_id: "officer-1",
        granted_by_user_id: "local-l4",
        valid_from: null,
      }),
    ])

    const updateCall = admin.recorded.find((entry) => entry.type === "update")
    expect(updateCall?.values).toMatchObject({
      is_active: false,
      granted_by_user_id: "local-l4",
    })
    expect(updateCall?.filters).toMatchObject({
      "eq:officer_user_id": "officer-1",
      "in:operation_catalog_id": ["catalog-2"],
    })
  })
})