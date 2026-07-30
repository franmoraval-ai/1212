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

function createAdminStub({ hasActiveCatalog = true } = {}) {
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
                if (table === "supervisions") {
                  return Promise.resolve({
                    data: [
                      { id: "sup-team", review_post: "Puesto Remoto", operation_name: "FUERA", supervisor_id: "sub-l3@demo.test" },
                      { id: "sup-other", review_post: "Otro", operation_name: "AJENO", supervisor_id: "other@demo.test" },
                    ],
                    error: null,
                  })
                }
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
                if (table === "operation_catalog") {
                  return Promise.resolve({
                    data: hasActiveCatalog
                      ? { id: "catalog-bcr-pavas", operation_name: "BCR", client_name: "Casa Pavas" }
                      : null,
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
                if (table === "operation_catalog") {
                  return Promise.resolve(callback({
                    data: hasActiveCatalog
                      ? [{ id: "catalog-bcr-pavas", operation_name: "BCR", client_name: "Casa Pavas" }]
                      : [],
                    error: null,
                  }))
                }
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
                if (table === "users") {
                  const managerFilter = filters.find((item) => item.column === "manager_user_id")
                  filters.length = 0
                  return Promise.resolve(callback({
                    data: managerFilter?.value === "local-l3-team"
                      ? [{ id: "auth-l3-subordinate", email: "sub-l3@demo.test", status: "Activo", role_level: 3 }]
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
        operation_catalog_id: "catalog-bcr-pavas",
      }),
    }))
    expect(admin.inserts[1]).toEqual(expect.objectContaining({
      table: "supervisions",
      values: expect.not.objectContaining({ officer_phone: expect.anything() }),
      values: expect.not.objectContaining({ operation_catalog_id: expect.anything() }),
    }))
  })

  it("rejects a novelty without a meaningful observation", async () => {
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
        status: "CON NOVEDAD",
        observations: "Todo en orden",
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "CON NOVEDAD requiere una observacion que describa el hallazgo.",
    })
    expect(admin.inserts).toEqual([])
  })

  it("requires photographic evidence for a novelty", async () => {
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
        status: "CON NOVEDAD",
        observations: "El oficial no portaba gorra.",
        checklist: { uniform: false },
        checklist_reasons: { uniform: "No portaba gorra." },
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "CON NOVEDAD requiere al menos una evidencia fotografica.",
    })
    expect(admin.inserts).toEqual([])
  })

  it("requires a justification for every failed checklist item in a novelty", async () => {
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
        status: "CON NOVEDAD",
        observations: "El oficial no portaba gorra.",
        photos: ["data:image/jpeg;base64,example"],
        checklist: { uniform: false },
        checklist_reasons: { uniform: "" },
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "CON NOVEDAD requiere justificar cada estándar no cumplido.",
    })
    expect(admin.inserts).toEqual([])
  })

  it("rejects a supervision for an inactive or unknown operation-post pair", async () => {
    const admin = createAdminStub({ hasActiveCatalog: false })
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
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "La operación y el puesto deben estar activos en el catálogo operativo.",
    })
    expect(admin.inserts).toEqual([])
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

  it("blocks L2 from updating supervision fields outside status and observations", async () => {
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
      body: JSON.stringify({ id: "sup-1", officer_name: "Oficial alterado" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Campos no permitidos para actualizar esta supervision.",
    })
    expect(admin.updates).toEqual([])
  })

  it("stamps the canonical catalog reference when a director changes the operation pair", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l4",
        userId: "local-l4",
        email: "director@demo.test",
        firstName: "Director",
        status: "Activo",
        assigned: "",
        roleLevel: 4,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/supervisions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "sup-1", operation_name: "BCR", review_post: "Casa Pavas" }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "supervisions",
        column: "id",
        value: "sup-1",
        values: expect.objectContaining({
          operation_name: "BCR",
          review_post: "Casa Pavas",
          operation_catalog_id: "catalog-bcr-pavas",
        }),
      }),
    ])
  })

  it("rejects an update that changes a supervision to a contradictory novelty", async () => {
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
      body: JSON.stringify({ id: "sup-1", status: "CON NOVEDAD", observations: "Sin novedad" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "CON NOVEDAD requiere una observacion que describa el hallazgo.",
    })
    expect(admin.updates).toEqual([])
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

  it("returns supervised team records for L3 hierarchy even outside assigned scope", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l3-team",
        userId: "local-l3-team",
        email: "manager@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: "ZZZ | Fuera",
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/supervisions?ids=sup-1,sup-2"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.records).toHaveLength(1)
    expect(body.records[0]).toMatchObject({ id: "sup-team", supervisor_id: "sub-l3@demo.test" })
  })
})
