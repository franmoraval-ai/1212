import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

import { POST } from "@/app/api/weapon-control/route"

type RecordedInsert = {
  table: string
  values: unknown
}

function createWeaponAdminStub() {
  const inserts: RecordedInsert[] = []
  const updates: unknown[] = []
  let updateCallCount = 0

  return {
    inserts,
    updates,
    client: {
      from(table: string) {
        return {
          select() {
            const builder = {
              eq() {
                return builder
              },
              maybeSingle() {
                if (table === "weapons") {
                  return Promise.resolve({
                    data: {
                      id: "weapon-1",
                      serial: "ABC123",
                      model: "Glock",
                      status: "Asignada",
                      assigned_to: "Casa Pavas",
                      ammo_count: 15,
                    },
                    error: null,
                  })
                }
                return Promise.resolve({ data: null, error: null })
              },
            }
            return builder
          },
          update(values: unknown) {
            updates.push(values)
            const builder = {
              eq() {
                updateCallCount += 1
                if (updateCallCount === 1) {
                  return Promise.resolve({ error: { message: 'column "ammo_count" does not exist' } })
                }
                return Promise.resolve({ error: null })
              },
            }
            return builder
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

describe("/api/weapon-control", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("blocks L2 weapon reassignment outside assigned scope", async () => {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: {},
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisor",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/weapon-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weaponId: "weapon-1",
        targetPost: "Casa Matriz",
        ammoCount: 10,
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe("No tiene permiso para reasignar armas fuera de su puesto u operación asignada.")
  })

  it("falls back when ammo_count is missing and returns a warning", async () => {
    const admin = createWeaponAdminStub()
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

    const response = await POST(new Request("http://localhost/api/weapon-control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weaponId: "weapon-1",
        targetPost: "Casa Pavas",
        ammoCount: 22,
        reason: "traslado",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.warning).toBe("El control se aplicó sin actualizar municiones porque la columna ammo_count aún no existe en la base.")
    expect(admin.updates).toHaveLength(2)
    expect(admin.updates[0]).toMatchObject({ assigned_to: "Casa Pavas", ammo_count: 22 })
    expect(admin.updates[1]).toMatchObject({ assigned_to: "Casa Pavas", status: "Asignada" })
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "weapon_control_logs",
        values: expect.objectContaining({
          changed_by_user_id: "auth-l4",
          reason: "traslado",
        }),
      }),
    ])
  })
})