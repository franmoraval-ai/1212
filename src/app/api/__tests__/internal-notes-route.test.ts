import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, stationMatchesAssignedMock, canAlertOfficerMock, sendPushToUserIdsMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  stationMatchesAssignedMock: vi.fn(() => false),
  canAlertOfficerMock: vi.fn(() => true),
  sendPushToUserIdsMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/stations", () => ({
  stationMatchesAssigned: stationMatchesAssignedMock,
}))

vi.mock("@/lib/push-authorization", () => ({
  canAlertOfficer: canAlertOfficerMock,
}))

vi.mock("@/lib/push-server", () => ({
  isPushConfigured: () => true,
  sendPushToUserIds: (...args: unknown[]) => sendPushToUserIdsMock(...args),
}))

import { DELETE, PATCH, POST } from "@/app/api/internal-notes/route"

function createAdminStub() {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []

  return {
    inserts,
    updates,
    deletes,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            return Promise.resolve({ error: null })
          },
          select() {
            return {
              eq(_column: string, value: string) {
                return {
                  maybeSingle() {
                    if (table === "users") {
                      return Promise.resolve({
                        data: {
                          id: value,
                          first_name: "Responsable L2",
                          email: "responsable@demo.test",
                          role_level: 2,
                          status: "Activo",
                          assigned: "BCR - Casa Pavas",
                        },
                        error: null,
                      })
                    }
                    return Promise.resolve({
                      data: {
                        id: "note-1",
                        post_name: "Casa Pavas",
                        reported_by_user_id: "other-user",
                        reported_by_email: "other@demo.test",
                        status: "resuelta",
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

describe("/api/internal-notes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendPushToUserIdsMock.mockResolvedValue({ sent: 1, targeted: 1, removed: 0 })
  })

  it("stamps actor identity on insert", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l1",
        userId: "local-l1",
        email: "oficial@demo.test",
        firstName: "Oficial",
        status: "Activo",
        assigned: "BCR - Casa Pavas",
        roleLevel: 1,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/internal-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        postName: "Casa Pavas",
        category: "suministros",
        priority: "alta",
        detail: "Faltan linternas",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "internal_notes",
        values: expect.objectContaining({
          reported_by_user_id: "auth-l1",
          reported_by_email: "oficial@demo.test",
          reported_by_name: "Oficial",
          post_name: "Casa Pavas",
        }),
      }),
    ])
  })

  it("allows scoped L2 updates when assigned post matches", async () => {
    const admin = createAdminStub()
    stationMatchesAssignedMock.mockReturnValue(true)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR - Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/internal-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "note-1", status: "en_proceso", assignedTo: "Supervisora" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "internal_notes",
        column: "id",
        value: "note-1",
        values: expect.objectContaining({ status: "en_proceso", assigned_to: "Supervisora" }),
      }),
    ])
  })

  it("assigns an active L2 by UUID and sends a push alert", async () => {
    const admin = createAdminStub()
    stationMatchesAssignedMock.mockReturnValue(true)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR - Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/internal-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "note-1", assignedToUserId: "target-l2", notifyAssignee: true }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, delivery: { sent: 1, targeted: 1 } })
    expect(admin.updates).toContainEqual(expect.objectContaining({
      table: "internal_notes",
      values: expect.objectContaining({ assigned_to_user_id: "target-l2", assigned_to: "Responsable L2" }),
    }))
    expect(sendPushToUserIdsMock).toHaveBeenCalledWith(admin.client, ["target-l2"], expect.objectContaining({
      title: "Novedad interna asignada",
      url: "/internal-notes",
      tag: "internal-note-note-1",
    }))
  })

  it("rejects an assignee outside the actor scope", async () => {
    const admin = createAdminStub()
    stationMatchesAssignedMock.mockReturnValue(true)
    canAlertOfficerMock.mockReturnValue(false)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR - Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/internal-notes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "note-1", assignedToUserId: "target-l2", notifyAssignee: true }),
    }))

    expect(response.status).toBe(403)
    expect(admin.updates).toEqual([])
    expect(sendPushToUserIdsMock).not.toHaveBeenCalled()
  })

  it("rejects delete outside L2 scope", async () => {
    const admin = createAdminStub()
    stationMatchesAssignedMock.mockReturnValue(false)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR - Casa Matriz",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/internal-notes", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "note-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Sin permiso para eliminar esta novedad interna." })
    expect(admin.deletes).toEqual([])
  })
})