import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, loadManagedTeamScopeMock, stationMatchesAssignedMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  loadManagedTeamScopeMock: vi.fn(),
  stationMatchesAssignedMock: vi.fn(() => false),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/stations", () => ({
  stationMatchesAssigned: stationMatchesAssignedMock,
}))

vi.mock("@/lib/manager-hierarchy", () => ({
  loadManagedTeamScope: loadManagedTeamScopeMock,
  matchesActorOrManagedUser: vi.fn(() => false),
}))

import { DELETE, GET, PATCH, POST } from "@/app/api/incidents/route"

function createAdminStub(options?: { incidentListData?: unknown[]; incidentByIdData?: Record<string, unknown>; hasFollowUps?: boolean }) {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []
  let insertCallCount = 0

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
              return Promise.resolve({ error: { message: 'column "evidence_bundle" does not exist' } })
            }
            return Promise.resolve({ error: null })
          },
          select(fields?: string) {
            if (table === "incident_follow_ups") {
              return {
                eq() {
                  return {
                    limit() {
                      return Promise.resolve({
                        data: options?.hasFollowUps ? [{ id: "follow-up-1" }] : [],
                        error: null,
                      })
                    },
                  }
                },
              }
            }
            if (table === "incidents" && String(fields ?? "").includes("time")) {
              return {
                order() {
                  return {
                    limit() {
                      return Promise.resolve({
                        data: options?.incidentListData ?? [{
                          id: "inc-closed",
                          time: "2026-07-29T10:00:00.000Z",
                          incident_type: "Acceso",
                          location: "Casa Pavas",
                          description: "Puerta sin seguro",
                          priority_level: "High",
                          status: "Cerrado",
                          reported_by_user_id: "auth-l1",
                          reported_by_email: "oficial@demo.test",
                          resolution_note: "Puerta asegurada y responsable notificado.",
                          resolved_at: "2026-07-29T10:30:00.000Z",
                          resolved_by_user_id: "auth-l2",
                          resolved_by_email: "supervisor@demo.test",
                        }],
                        error: null,
                      })
                    },
                  }
                },
              }
            }
            if (table === "users") {
              return {
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({
                        data: {
                          id: "officer-1",
                          first_name: "Oficial Responsable",
                          email: "oficial@demo.test",
                          role_level: 1,
                          status: "Activo",
                          assigned: "BCR - Casa Pavas",
                        },
                        error: null,
                      })
                    },
                  }
                },
              }
            }
            return {
              eq() {
                return {
                  maybeSingle() {
                    return Promise.resolve({
                      data: options?.incidentByIdData ?? {
                        id: "inc-1",
                        location: "Casa Pavas",
                        lugar: null,
                        reported_by_user_id: "other-user",
                        reported_by_email: "other@demo.test",
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

describe("/api/incidents", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadManagedTeamScopeMock.mockResolvedValue({ scope: { userIds: new Set(), emails: new Set() }, error: null })
  })

  it("returns closure traceability fields for visible incidents", async () => {
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

    const response = await GET(new Request("http://localhost/api/incidents"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      incidents: [expect.objectContaining({
        id: "inc-closed",
        resolutionNote: "Puerta asegurada y responsable notificado.",
        resolvedAt: "2026-07-29T10:30:00.000Z",
        resolvedByUserId: "auth-l2",
        resolvedByEmail: "supervisor@demo.test",
      })],
    })
  })

  it("stamps actor identity and falls back when compat columns are missing during insert", async () => {
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

    const response = await POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Puerta abierta",
        incidentType: "Acceso",
        location: "Casa Pavas",
        evidenceBundle: { ok: true },
        geoRiskLevel: "medium",
        geoRiskFlags: ["fast-hop"],
        estimatedSpeedKmh: 90,
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toHaveLength(2)
    expect(admin.inserts[0]).toEqual(expect.objectContaining({
      table: "incidents",
      values: expect.objectContaining({
        reported_by_user_id: "auth-l1",
        reported_by_email: "oficial@demo.test",
        evidence_bundle: { ok: true },
      }),
    }))
    expect(admin.inserts[1]).toEqual(expect.objectContaining({
      table: "incidents",
      values: expect.not.objectContaining({ evidence_bundle: expect.anything() }),
    }))
  })

  it("normalizes legacy pending status and rejects unknown incident states", async () => {
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

    const legacyResponse = await POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Puerta abierta",
        incidentType: "Acceso",
        location: "Casa Pavas",
        status: "PENDIENTE",
      }),
    }))

    expect(legacyResponse.status).toBe(200)
    expect(admin.inserts[0]).toEqual(expect.objectContaining({
      values: expect.objectContaining({ status: "Abierto" }),
    }))

    const invalidResponse = await POST(new Request("http://localhost/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Puerta abierta",
        incidentType: "Acceso",
        location: "Casa Pavas",
        status: "Archivado",
      }),
    }))

    expect(invalidResponse.status).toBe(400)
    await expect(invalidResponse.json()).resolves.toMatchObject({ error: "Estado de incidente no válido." })
  })

  it("returns canonical status labels for historical incidents", async () => {
    const admin = createAdminStub({
      incidentListData: [{
        id: "incident-legacy",
        time: "2026-07-29T12:00:00.000Z",
        incident_type: "Acceso",
        location: "Casa Pavas",
        description: "Puerta abierta",
        priority_level: "Medium",
        status: "PENDIENTE",
        reported_by_user_id: "auth-l1",
        reported_by_email: "oficial@demo.test",
      }],
    })
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

    const response = await GET(new Request("http://localhost/api/incidents"))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      incidents: [expect.objectContaining({ id: "incident-legacy", status: "Abierto" })],
    })
  })

  it("allows scoped L2 updates when assigned post matches the incident", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1", status: "Cerrado", resolutionNote: "Acceso asegurado y puerta cerrada." }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "incidents",
        column: "id",
        value: "inc-1",
        values: expect.objectContaining({
          status: "Cerrado",
          resolution_note: "Acceso asegurado y puerta cerrada.",
          resolved_by_user_id: "auth-l2",
          resolved_by_email: "supervisor@demo.test",
          resolved_at: expect.any(String),
        }),
      }),
    ])
  })

  it("does not allow generic changes to a closed incident", async () => {
    const admin = createAdminStub({
      incidentByIdData: {
        id: "inc-1",
        location: "Casa Pavas",
        lugar: null,
        status: "Cerrado",
        reported_by_user_id: "other-user",
        reported_by_email: "other@demo.test",
      },
    })
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

    const response = await PATCH(new Request("http://localhost/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1", priorityLevel: "High" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Un incidente cerrado no admite cambios; registre un seguimiento o use una acción de auditoría específica.",
    })
    expect(admin.updates).toHaveLength(0)
  })

  it("rejects closing an incident without a resolution note", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1", status: "Cerrado" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "Cerrar un incidente requiere documentar la resolución.",
    })
    expect(admin.updates).toEqual([])
  })

  it("assigns an in-scope active user and records assignment traceability", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/incidents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1", assignedToUserId: "officer-1" }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "incidents",
        values: expect.objectContaining({
          assigned_to_user_id: "officer-1",
          assigned_to_email: "oficial@demo.test",
          assigned_to_name: "Oficial Responsable",
          assigned_at: expect.any(String),
          assigned_by_user_id: "auth-l2",
          assigned_by_email: "supervisor@demo.test",
        }),
      }),
    ])
  })

  it("rejects delete when L2 is outside incident scope", async () => {
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

    const response = await DELETE(new Request("http://localhost/api/incidents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Sin permiso para eliminar este incidente." })
    expect(admin.deletes).toEqual([])
  })

  it("does not delete a closed incident and its follow-up history", async () => {
    const admin = createAdminStub({
      incidentByIdData: {
        id: "inc-1",
        location: "Casa Pavas",
        lugar: null,
        status: "Cerrado",
        reported_by_user_id: "other-user",
        reported_by_email: "other@demo.test",
      },
    })
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

    const response = await DELETE(new Request("http://localhost/api/incidents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "No se puede eliminar un incidente cerrado porque conserva evidencia y seguimiento.",
    })
    expect(admin.deletes).toHaveLength(0)
  })

  it("does not delete an open incident with registered follow-ups", async () => {
    const admin = createAdminStub({ hasFollowUps: true })
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

    const response = await DELETE(new Request("http://localhost/api/incidents", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "inc-1" }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: "No se puede eliminar un incidente con seguimientos registrados.",
    })
    expect(admin.deletes).toHaveLength(0)
  })
})