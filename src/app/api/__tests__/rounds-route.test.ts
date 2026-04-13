import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

import { DELETE, PATCH, POST } from "@/app/api/rounds/route"

function createAdminStub() {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []
  const queries: Array<{ table: string; operation: string; filters?: Array<{ column: string; value: unknown }> }> = []
  const filters: Array<{ column: string; value: unknown }> = []

  return {
    inserts,
    updates,
    deletes,
    queries,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            return Promise.resolve({ error: null })
          },
          select() {
            return {
              eq(column: string, value: unknown) {
                filters.push({ column, value })
                return this
              },
              maybeSingle() {
                queries.push({ table, operation: "select-maybeSingle", filters: [...filters] })
                filters.length = 0
                if (table === "rounds") {
                  return Promise.resolve({ data: { post: "Casa Pavas" }, error: null })
                }
                return Promise.resolve({ data: null, error: null })
              },
              then(callback: (result: { data: unknown[]; error: null }) => unknown) {
                queries.push({ table, operation: "select-then", filters: [...filters] })
                filters.length = 0
                if (table === "station_officer_authorizations") {
                  return Promise.resolve(callback({
                    data: [{
                      is_active: true,
                      valid_from: null,
                      valid_to: null,
                      operation_catalog: { operation_name: "BCR", client_name: "Casa Pavas" },
                    }],
                    error: null,
                  }))
                }
                return Promise.resolve(callback({ data: [], error: null }))
              },
            }
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

describe("/api/rounds", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("creates a round definition for L4", async () => {
    const admin = createAdminStub()
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

    const response = await POST(new Request("http://localhost/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "round-1", name: "Ronda Norte", post: "Casa Pavas", status: "Activa" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "rounds",
        values: expect.objectContaining({ id: "round-1", name: "Ronda Norte", post: "Casa Pavas" }),
      }),
    ])
  })

  it("updates a round definition for L4", async () => {
    const admin = createAdminStub()
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

    const response = await PATCH(new Request("http://localhost/api/rounds", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "round-1", status: "Inactiva", checkpoints: [{ name: "P1" }] }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "rounds",
        column: "id",
        value: "round-1",
        values: expect.objectContaining({ status: "Inactiva", checkpoints: [{ name: "P1" }] }),
      }),
    ])
  })

  it("rejects non-L4 deletion attempts", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "manager@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: null,
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/rounds", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "round-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Solo L4 puede administrar definiciones de ronda." })
    expect(admin.deletes).toEqual([])
  })

  it("allows L3 creation for authorized post scope", async () => {
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

    const response = await POST(new Request("http://localhost/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "round-2", name: "Ronda Sur", post: "Casa Pavas", status: "Activa" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toHaveLength(1)
  })

  it("rejects L2/L3 creation outside authorized scope", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "round-3", name: "Ronda Centro", post: "Otro Puesto", status: "Activa" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "El puesto de la ronda está fuera de su dominio autorizado." })
    expect(admin.inserts).toHaveLength(0)
  })
})
