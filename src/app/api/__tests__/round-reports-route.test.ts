import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

import { DELETE, PATCH, POST } from "@/app/api/round-reports/route"

function createAdminStub() {
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const deletes: unknown[] = []
  let updateCallCount = 0

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
          update(values: unknown) {
            return {
              eq(column: string, value: string) {
                updates.push({ table, values, column, value })
                updateCallCount += 1
                if (updateCallCount === 1) {
                  return Promise.resolve({ error: { message: 'column "supervisor_name" does not exist' } })
                }
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

describe("/api/round-reports", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("stamps actor uid on insert", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l1",
        userId: "local-l1",
        email: "oficial@demo.test",
        firstName: "Oficial",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 1,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/round-reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "report-1", round_name: "Ronda Norte", post_name: "Casa Pavas", officer_id: "tampered" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true })
    expect(admin.inserts).toEqual([
      expect.objectContaining({
        table: "round_reports",
        values: expect.objectContaining({ officer_id: "auth-l1", round_name: "Ronda Norte" }),
      }),
    ])
  })

  it("falls back when supervisor columns are missing during update", async () => {
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

    const response = await PATCH(new Request("http://localhost/api/round-reports", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "report-1", supervisor_name: "Directora", status: "COMPLETA" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, warning: expect.any(String) })
    expect(admin.updates).toHaveLength(2)
    expect(admin.updates[0]).toEqual(expect.objectContaining({
      table: "round_reports",
      values: expect.objectContaining({ supervisor_name: "Directora", status: "COMPLETA" }),
    }))
    expect(admin.updates[1]).toEqual(expect.objectContaining({
      table: "round_reports",
      values: expect.not.objectContaining({ supervisor_name: expect.anything() }),
    }))
  })

  it("rejects non-L4 delete attempts", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisora",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await DELETE(new Request("http://localhost/api/round-reports", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "report-1" }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body).toMatchObject({ error: "Solo L4 puede administrar boletas de ronda." })
    expect(admin.deletes).toEqual([])
  })
})