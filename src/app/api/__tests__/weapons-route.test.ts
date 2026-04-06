import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isManagerMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isManagerMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 3),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isManager: isManagerMock,
}))

import { POST } from "@/app/api/weapons/route"

function createAdminStub() {
  const inserts: unknown[] = []
  let insertCallCount = 0

  return {
    inserts,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            insertCallCount += 1
            if (insertCallCount === 1) {
              return Promise.resolve({ error: { message: 'column "ammo_count" does not exist' } })
            }
            return Promise.resolve({ error: null })
          },
        }
      },
    },
  }
}

describe("/api/weapons", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("falls back when ammo_count is missing during insert", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "manager@demo.test",
        firstName: "Manager",
        status: "Activo",
        assigned: null,
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/weapons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "Glock 17",
        serial: "ABC123",
        type: "Pistola",
        status: "Bodega",
        assignedTo: "",
        ammoCount: 18,
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, insertedCount: 1 })
    expect(admin.inserts).toHaveLength(2)
    expect(admin.inserts[0]).toEqual(expect.objectContaining({
      table: "weapons",
      values: [expect.objectContaining({ ammo_count: 18 })],
    }))
    expect(admin.inserts[1]).toEqual(expect.objectContaining({
      table: "weapons",
      values: [expect.not.objectContaining({ ammo_count: expect.anything() })],
    }))
  })
})