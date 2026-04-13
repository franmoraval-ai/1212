import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

import { DELETE, GET, PATCH, POST } from "@/app/api/supervisions/route"

function createAdminStub() {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []
  let insertCallCount = 0
  const filters: Array<{ column: string; value: unknown }> = []

  return {
    inserts,
    updates,
    deletes,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            insertCallCount += 1
            if (insertCallCount === 1) {
              return Promise.resolve({ error: { message: 'column "officer_phone" does not exist' } })
            }
            return Promise.resolve({ error: null })
          },
          select() {
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value })
                return builder
              },
              in() {
                return Promise.resolve({ data: [], error: null })
              },
              maybeSingle() {
                if (table === "supervisions") {
                  return Promise.resolve({
                    data: {
                      id: "sup-1",
                      supervisor_id: "owner@demo.test",
                      review_post: "Casa Pavas",
                      operation_name: "BCR",
                    },
                    error: null,
                  })
                }
                return Promise.resolve({ data: null, error: null })
              },
              order() {
                return Promise.resolve({
                  data: [
                    { id: "sup-1", review_post: "Casa Pavas", operation_name: "BCR", supervisor_id: "owner@demo.test" },
                    { id: "sup-2", review_post: "Otro Puesto", operation_name: "XYZ", supervisor_id: "owner@demo.test" },
                  ],
                  error: null,
                })
              },
              then(callback: (result: { data: unknown[]; error: null }) => unknown) {
                if (table === "station_officer_authorizations") {
                  const officerFilter = filters.find((item) => item.column === "officer_user_id")
                  filters.length = 0
                  return Promise.resolve(callback({
                    data: officerFilter?.value
                      ? [{
                        is_active: true,
                        valid_from: null,
                        valid_to: null,
                        operation_catalog: { operation_name: "BCR", client_name: "Casa Pavas" },
                      }]
                      : [],
                    error: null,
                  }))
                }
                filters.length = 0
                return Promise.resolve(callback({ data: [], error: null }))
              },
            }

            return builder
          },
          update(values: unknown) {
            return {
              eq(column: string, value: string) {
                updates.push({ table, values, column, value })
                return Promise.resolve({ error: null })
              },
            }
          },
          delete() {
            return {
              eq(column: string, value: string) {
                deletes.push({ table, column, value })
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    },
  }
}

describe("/api/supervisions", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stamps actor identity and falls back when optional supervision columns are missing", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "owner@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/supervisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operation_name: "BCR",
        review_post: "Casa Pavas",
        officer_name: "Oficial Uno",
        id_number: "123",
        officer_phone: "8888-9999",
        evidence_bundle: { ok: true },
        geo_risk: { risk: "medium" },
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, warning: expect.any(String) })
    expect(admin.inserts).toHaveLength(2)
    expect(admin.inserts[0]).toEqual(expect.objectContaining({
      table: "supervisions",
      values: expect.objectContaining({
        supervisor_id: "owner@demo.test",
        officer_phone: "8888-9999",
      }),
    }))
    expect(admin.inserts[1]).toEqual(expect.objectContaining({
      table: "supervisions",
      values: expect.not.objectContaining({ officer_phone: expect.anything() }),
    }))
  })

  it("allows owner updates for non-director users", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "owner@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/supervisions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "sup-1", status: "CUMPLIM", observations: "Todo bien" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "supervisions",
        column: "id",
        value: "sup-1",
        values: expect.objectContaining({ status: "CUMPLIM", observations: "Todo bien" }),
      }),
    ])
  })

  it("rejects delete outside ownership scope for non-director users", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "other@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/supervisions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "sup-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Sin permiso para eliminar esta supervision." })
    expect(admin.deletes).toEqual([])
  })

  it("returns only in-scope supervisions for L3/L2", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "manager@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/supervisions"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.records).toHaveLength(1)
    expect(body.records[0]).toMatchObject({ id: "sup-1", review_post: "Casa Pavas", operation_name: "BCR" })
  })
})
