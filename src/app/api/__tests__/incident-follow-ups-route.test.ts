import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, loadManagedTeamScopeMock, stationMatchesAssignedMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  loadManagedTeamScopeMock: vi.fn(),
  stationMatchesAssignedMock: vi.fn(() => true),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/manager-hierarchy", () => ({
  loadManagedTeamScope: loadManagedTeamScopeMock,
  matchesActorOrManagedUser: vi.fn(() => false),
}))

vi.mock("@/lib/stations", () => ({
  stationMatchesAssigned: stationMatchesAssignedMock,
}))

import { GET, POST } from "@/app/api/incidents/[incidentId]/follow-ups/route"

function createAdminStub() {
  const inserts: unknown[] = []

  return {
    inserts,
    client: {
      from(table: string) {
        return {
          select() {
            if (table === "incidents") {
              return {
                eq() {
                  return {
                    maybeSingle() {
                      return Promise.resolve({
                        data: {
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
            }

            return {
              eq() {
                return {
                  order() {
                    return {
                      limit() {
                        return Promise.resolve({
                          data: [{
                            id: "follow-1",
                            note: "Se notificó al encargado del puesto.",
                            created_at: "2026-07-29T12:00:00.000Z",
                            created_by_user_id: "auth-l2",
                            created_by_email: "supervisor@demo.test",
                            created_by_name: "Supervisora",
                          }],
                          error: null,
                        })
                      },
                    }
                  },
                }
              },
            }
          },
          insert(values: unknown) {
            inserts.push({ table, values })
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  }
}

const params = { params: Promise.resolve({ incidentId: "inc-1" }) }

describe("/api/incidents/[incidentId]/follow-ups", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadManagedTeamScopeMock.mockResolvedValue({ scope: { userIds: new Set(), emails: new Set() }, error: null })
  })

  it("returns immutable follow-up records to an authorized viewer", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l4",
        userId: "local-l4",
        email: "director@demo.test",
        firstName: "Director",
        status: "Activo",
        assigned: null,
        roleLevel: 4,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/incidents/inc-1/follow-ups"), params)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      followUps: [expect.objectContaining({
        id: "follow-1",
        note: "Se notificó al encargado del puesto.",
        createdByEmail: "supervisor@demo.test",
      })],
    })
  })

  it("stamps the actor when an in-scope L2 registers follow-up", async () => {
    const admin = createAdminStub()
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

    const response = await POST(new Request("http://localhost/api/incidents/inc-1/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Se coordinó el cierre con seguridad física." }),
    }), params)

    expect(response.status).toBe(201)
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "incident_follow_ups",
        values: expect.objectContaining({
          incident_id: "inc-1",
          note: "Se coordinó el cierre con seguridad física.",
          created_by_user_id: "auth-l2",
          created_by_email: "supervisor@demo.test",
          created_by_name: "Supervisora",
        }),
      }),
    ])
  })

  it("rejects follow-up creation by L1", async () => {
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

    const response = await POST(new Request("http://localhost/api/incidents/inc-1/follow-ups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: "Intento no autorizado." }),
    }), params)

    expect(response.status).toBe(403)
    expect(admin.inserts).toEqual([])
  })
})