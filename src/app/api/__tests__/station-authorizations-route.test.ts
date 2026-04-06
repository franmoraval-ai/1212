import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

import { POST } from "@/app/api/station-authorizations/route"

type RecordedCall = {
  type: "upsert" | "update"
  table: string
  values: unknown
  options?: unknown
  filters?: Array<{ kind: "eq" | "in"; column: string; value: unknown }>
}

function createAdminStub() {
  const recorded: RecordedCall[] = []

  return {
    recorded,
    client: {
      from(table: string) {
        return {
          select() {
            const filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }> = []
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ kind: "eq", column, value })
                return builder
              },
              in(column: string, value: unknown[]) {
                filters.push({ kind: "in", column, value })
                return builder
              },
              maybeSingle() {
                if (table === "operation_catalog") {
                  return Promise.resolve({ data: { id: "catalog-1" }, error: null })
                }
                return Promise.resolve({ data: null, error: null })
              },
              then(onFulfilled?: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                if (table === "users") {
                  return Promise.resolve({ data: [{ id: "officer-1" }], error: null }).then(onFulfilled, onRejected)
                }
                if (table === "station_officer_authorizations") {
                  return Promise.resolve({
                    data: [{ id: "row-2", officer_user_id: "officer-2", is_active: true }],
                    error: null,
                  }).then(onFulfilled, onRejected)
                }
                return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
              },
            }
            return builder
          },
          upsert(values: unknown, options?: unknown) {
            recorded.push({ type: "upsert", table, values, options })
            return Promise.resolve({ error: null })
          },
          update(values: unknown) {
            const filters: Array<{ kind: "eq" | "in"; column: string; value: unknown }> = []
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ kind: "eq", column, value })
                return builder
              },
              in(column: string, value: unknown[]) {
                filters.push({ kind: "in", column, value })
                recorded.push({ type: "update", table, values, filters: [...filters] })
                return Promise.resolve({ error: null })
              },
            }
            return builder
          },
        }
      },
    },
  }
}

describe("/api/station-authorizations", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("writes granted_by_user_id using actor.userId and deactivates removed officers", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-user-1",
        userId: "local-user-99",
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

    const response = await POST(new Request("http://localhost/api/station-authorizations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationCatalogId: "catalog-1",
        officerUserIds: ["officer-1"],
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, authorizedCount: 1 })

    const upsertCall = admin.recorded.find((item) => item.type === "upsert")
    expect(upsertCall).toBeTruthy()
    expect(upsertCall?.values).toEqual([
      expect.objectContaining({
        operation_catalog_id: "catalog-1",
        officer_user_id: "officer-1",
        granted_by_user_id: "local-user-99",
      }),
    ])

    const updateCall = admin.recorded.find((item) => item.type === "update")
    expect(updateCall).toBeTruthy()
    expect(updateCall?.values).toMatchObject({
      is_active: false,
      granted_by_user_id: "local-user-99",
    })
    expect(updateCall?.filters).toContainEqual({ kind: "eq", column: "operation_catalog_id", value: "catalog-1" })
    expect(updateCall?.filters).toContainEqual({ kind: "in", column: "officer_user_id", value: ["officer-2"] })
  })
})