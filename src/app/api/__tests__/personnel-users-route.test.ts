import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock, writeAuditEventMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  writeAuditEventMock: vi.fn().mockResolvedValue(true),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

vi.mock("@/lib/audit-log", () => ({
  writeAuditEvent: writeAuditEventMock,
}))

import { DELETE, PATCH } from "@/app/api/personnel/users/route"

function createAdminStub(userRoleLevel = 1) {
  const updates: unknown[] = []
  const deletes: unknown[] = []
  const userRows = new Map<string, { id: string; role_level: number; status: string; manager_user_id: string | null }>([
    ["user-1", { id: "user-1", role_level: userRoleLevel, status: "Activo", manager_user_id: null }],
    ["manager-1", { id: "manager-1", role_level: 3, status: "Activo", manager_user_id: null }],
  ])

  return {
    updates,
    deletes,
    client: {
      from(table: string) {
        return {
          select() {
            const filters = new Map<string, string>()
            return {
              eq(column: string, value: string) {
                filters.set(column, value)
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: userRows.get(filters.get("id") ?? "") ?? null,
                      error: null,
                    })
                  },
                }
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

describe("/api/personnel/users", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("updates role and status for L4 user management", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/personnel/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user-1", roleLevel: 2, status: "Inactivo" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "users",
        column: "id",
        value: "user-1",
        values: expect.objectContaining({ role_level: 2, status: "Inactivo" }),
      }),
    ])
    expect(writeAuditEventMock).toHaveBeenCalledWith(
      admin.client,
      expect.objectContaining({ userId: "local-l4" }),
      expect.objectContaining({ action: "personnel.user.updated", resourceId: "user-1" }),
      expect.any(Request)
    )
  })

  it("rejects non-L4 management attempts", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/personnel/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user-1", status: "Activo" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Solo nivel 4 puede administrar usuarios." })
    expect(admin.updates).toEqual([])
  })

  it("deletes a user for L4 management", async () => {
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

    const response = await DELETE(new Request("http://localhost/api/personnel/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.deletes).toEqual([
      expect.objectContaining({
        table: "users",
        column: "id",
        value: "user-1",
      }),
    ])
    expect(writeAuditEventMock).toHaveBeenCalledWith(
      admin.client,
      expect.objectContaining({ userId: "local-l4" }),
      expect.objectContaining({ action: "personnel.user.deleted", resourceId: "user-1" }),
      expect.any(Request)
    )
  })

  it("requires L2 supervisors to use account-scoped managers", async () => {
    const admin = createAdminStub(2)
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

    const response = await PATCH(new Request("http://localhost/api/personnel/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "user-1", managerUserId: "manager-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: "Los L2 deben configurar su L3 por cuenta." })
    expect(admin.updates).toEqual([])
  })
})