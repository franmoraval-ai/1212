import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock, hasCustomPermissionMock, loadCommandOperationCatalogMock, writeAuditEventMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  hasCustomPermissionMock: vi.fn((actor: { customPermissions?: string[] } | null, permission: string) => {
    return Array.isArray(actor?.customPermissions) && actor.customPermissions.includes(permission)
  }),
  loadCommandOperationCatalogMock: vi.fn(),
  writeAuditEventMock: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
  hasCustomPermission: hasCustomPermissionMock,
}))

vi.mock("@/lib/station-command-scope", () => ({
  loadCommandOperationCatalog: loadCommandOperationCatalogMock,
}))

vi.mock("@/lib/audit-log", () => ({
  writeAuditEvent: writeAuditEventMock,
}))

import { DELETE, GET, POST } from "@/app/api/operation-catalog/route"

function createAdminStub() {
  const inserts: Array<{ table: string; values: unknown }> = []
  const deletes: Array<{ table: string; column: string; value: unknown }> = []

  return {
    inserts,
    deletes,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            if (table === "operation_catalog") {
              return {
                select() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({ data: { id: "catalog-created" }, error: null })
                    },
                  }
                },
              }
            }
            return Promise.resolve({ error: null })
          },
          delete() {
            return {
              eq(column: string, value: unknown) {
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

function createRequestClientStubForL2Authorized() {
  return {
    from(table: string) {
      if (table === "station_officer_authorizations") {
        const chain = {
          select() { return chain },
          eq() { return chain },
          then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve({
              data: [
                {
                  is_active: true,
                  valid_from: "2026-01-01T00:00:00.000Z",
                  valid_to: null,
                  operation_catalog: {
                    id: "catalog-1",
                    operation_name: "BCR",
                    client_name: "CASA PAVAS",
                    is_active: true,
                  },
                },
              ],
              error: null,
            }).then(onFulfilled, onRejected)
          },
        }
        return chain
      }

      const chain = {
        select() { return chain },
        order() { return chain },
        then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

function createRequestClientStubForL2Fallback() {
  return {
    from(_table: string) {
      const chain = {
        select() { return chain },
        eq() { return chain },
        then(onFulfilled?: (value: { data: null; error: { message: string } }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({
            data: null,
            error: { message: 'relation "station_officer_authorizations" does not exist' },
          }).then(onFulfilled, onRejected)
        },
      }
      return chain
    },
  }
}

describe("/api/operation-catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("normalizes insert payloads for L4 writes", async () => {
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

    const response = await POST(new Request("http://localhost/api/operation-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: " bcr ",
        clientName: " casa pavas ",
        isActive: false,
        createdAt: "2026-04-03T10:00:00.000Z",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "operation_catalog",
        values: expect.objectContaining({
          operation_name: "BCR",
          client_name: "CASA PAVAS",
          is_active: false,
          created_at: "2026-04-03T10:00:00.000Z",
        }),
      }),
    ])
    expect(writeAuditEventMock).toHaveBeenCalledWith(
      admin.client,
      expect.objectContaining({ userId: "local-l4" }),
      expect.objectContaining({ action: "operations.catalog.created", resourceType: "operation_catalog" }),
      expect.any(Request)
    )
  })

  it("allows L3 creation and assigns the new post to their command scope", async () => {
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

    const response = await POST(new Request("http://localhost/api/operation-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "bcr",
        clientName: "puesto uno",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, id: "catalog-created" })
    expect(admin.inserts).toContainEqual(expect.objectContaining({
      table: "station_officer_authorizations",
      values: expect.objectContaining({
        operation_catalog_id: "catalog-created",
        officer_user_id: "local-l3",
        granted_by_user_id: "local-l3",
        is_active: true,
      }),
    }))
  })

  it("blocks L2 catalog creation even if a legacy delegated permission is present", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisor",
        status: "Activo",
        assigned: null,
        roleLevel: 2,
        customPermissions: ["operation_catalog_manage"],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/operation-catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationName: "bcr",
        clientName: "puesto uno",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Solo L3 o L4 puede crear puestos operativos." })
    expect(admin.inserts).toEqual([])
  })

  it("allows L3 to delete a post under their command", async () => {
    const admin = createAdminStub()
    loadCommandOperationCatalogMock.mockResolvedValue({
      rows: [{ id: "catalog-owned", operation_name: "BCR", client_name: "Casa Pavas", is_active: true }],
      error: null,
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: { uid: "auth-l3", userId: "local-l3", email: "l3@demo.test", firstName: "Gerente", status: "Activo", assigned: null, roleLevel: 3, customPermissions: [] },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/operation-catalog", {
      method: "DELETE",
      body: JSON.stringify({ id: "catalog-owned" }),
    }))

    expect(response.status).toBe(200)
    expect(admin.deletes).toContainEqual({ table: "operation_catalog", column: "id", value: "catalog-owned" })
  })

  it("prevents L3 from deleting a post outside their command", async () => {
    const admin = createAdminStub()
    loadCommandOperationCatalogMock.mockResolvedValue({ rows: [], error: null })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: { uid: "auth-l3", userId: "local-l3", email: "l3@demo.test", firstName: "Gerente", status: "Activo", assigned: null, roleLevel: 3, customPermissions: [] },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/operation-catalog", {
      method: "DELETE",
      body: JSON.stringify({ id: "catalog-outside" }),
    }))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ error: "Solo puede eliminar puestos que estén bajo su cargo." })
    expect(admin.deletes).toEqual([])
  })

  it("returns only command-scoped operation rows for L2", async () => {
    const admin = {}
    loadCommandOperationCatalogMock.mockResolvedValue({
      rows: [{ id: "catalog-1", operation_name: "BCR", client_name: "CASA PAVAS", is_active: true }],
      error: null,
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "l2@demo.test",
        firstName: "Supervisor",
        status: "Activo",
        assigned: "BCR | CASA PAVAS",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/operation-catalog"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      operations: [
        {
          id: "catalog-1",
          operationName: "BCR",
          clientName: "CASA PAVAS",
          isActive: true,
        },
      ],
    })
    expect(loadCommandOperationCatalogMock).toHaveBeenCalledWith(admin, expect.objectContaining({ roleLevel: 2 }))
  })

  it("uses the same command scope for L3", async () => {
    const admin = {}
    loadCommandOperationCatalogMock.mockResolvedValue({
      rows: [{ id: "catalog-2", operation_name: "INS", client_name: "HEREDIA", is_active: true }],
      error: null,
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "l3@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: "INS | Heredia",
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/operation-catalog"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      operations: [
        {
          id: "catalog-2",
          operationName: "INS",
          clientName: "HEREDIA",
          isActive: true,
        },
      ],
    })
    expect(loadCommandOperationCatalogMock).toHaveBeenCalledWith(admin, expect.objectContaining({ roleLevel: 3 }))
  })
})
