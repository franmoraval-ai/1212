import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, stationMatchesAssignedMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  stationMatchesAssignedMock: vi.fn(() => false),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/stations", () => ({
  stationMatchesAssigned: stationMatchesAssignedMock,
}))

import { DELETE, PATCH, POST } from "@/app/api/incidents/route"

function createAdminStub() {
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
          select() {
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
      body: JSON.stringify({ id: "inc-1", status: "Cerrado" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.updates).toEqual([
      expect.objectContaining({
        table: "incidents",
        column: "id",
        value: "inc-1",
        values: expect.objectContaining({ status: "Cerrado" }),
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
})