import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, writeAuditEventMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  writeAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/audit-log", () => ({
  writeAuditEvent: writeAuditEventMock,
}))

import { POST } from "@/app/api/supervision/officers/route"

function createAdminStub(existingOfficer: Record<string, unknown> | null = null) {
  const inserts: Array<{ table: string; values: unknown }> = []
  const updates: Array<{ table: string; values: unknown; id: string }> = []
  const upserts: Array<{ table: string; values: unknown }> = []

  const client = {
    from(table: string) {
      return {
        select() {
          const builder = {
            eq() {
              return builder
            },
            maybeSingle() {
              if (table === "operation_catalog") {
                return Promise.resolve({ data: { id: "catalog-1" }, error: null })
              }
              return Promise.resolve({ data: null, error: null })
            },
            then(callback: (value: { data: unknown[]; error: null }) => unknown) {
              return Promise.resolve(callback({ data: table === "personnel_registry" && existingOfficer ? [existingOfficer] : [], error: null }))
            },
          }
          return builder
        },
        insert(values: unknown) {
          inserts.push({ table, values })
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: {
                      id: "registry-new",
                      personnel_code: "HO-000019",
                      linked_user_id: null,
                      full_name: "Oficial Nuevo",
                      id_number: "1-2222-3333",
                      phone: "8888-1111",
                      status: "ACTIVO",
                      source: "PREREGISTRO",
                    },
                    error: null,
                  })
                },
              }
            },
          }
        },
        update(values: unknown) {
          return {
            eq(_column: string, id: string) {
              updates.push({ table, values, id })
              return Promise.resolve({ error: null })
            },
          }
        },
        upsert(values: unknown) {
          upserts.push({ table, values })
          return Promise.resolve({ error: null })
        },
        delete() {
          return {
            eq() {
              return Promise.resolve({ error: null })
            },
          }
        },
      }
    },
  }

  return { client, inserts, updates, upserts }
}

describe("/api/supervision/officers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function authenticate(client: ReturnType<typeof createAdminStub>["client"]) {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "l2@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })
  }

  it("creates a reusable preregistration and assigns it to the selected post", async () => {
    const admin = createAdminStub()
    authenticate(admin.client)

    const response = await POST(new Request("http://localhost/api/supervision/officers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Oficial Nuevo",
        idNumber: "1-2222-3333",
        phone: "8888-1111",
        operationCatalogId: "catalog-1",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      created: true,
      officer: { id: "registry-new", personnelCode: "HO-000019", source: "PREREGISTRO" },
    })
    expect(admin.inserts).toContainEqual(expect.objectContaining({ table: "personnel_registry" }))
    expect(admin.upserts).toContainEqual({
      table: "personnel_registry_assignments",
      values: expect.objectContaining({ personnel_registry_id: "registry-new", operation_catalog_id: "catalog-1" }),
    })
  })

  it("reuses an existing officer when the formatted identity number matches", async () => {
    const admin = createAdminStub({
      id: "registry-existing",
      personnel_code: "HO-000007",
      linked_user_id: null,
      full_name: "Oficial Existente",
      id_number: "1 2222 3333",
      phone: null,
      status: "ACTIVO",
      source: "PREREGISTRO",
    })
    authenticate(admin.client)

    const response = await POST(new Request("http://localhost/api/supervision/officers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Otro texto",
        idNumber: "1-2222-3333",
        phone: "8888-1111",
        operationCatalogId: "catalog-1",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, created: false, officer: { id: "registry-existing", name: "Oficial Existente" } })
    expect(admin.inserts).toEqual([])
    expect(admin.updates).toContainEqual(expect.objectContaining({ table: "personnel_registry", id: "registry-existing" }))
  })
})