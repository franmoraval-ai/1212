import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock, getBearerTokenFromRequestMock, createRequestSupabaseClientMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  getBearerTokenFromRequestMock: vi.fn(() => "token"),
  createRequestSupabaseClientMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

vi.mock("@/lib/request-supabase", () => ({
  getBearerTokenFromRequest: getBearerTokenFromRequestMock,
  createRequestSupabaseClient: createRequestSupabaseClientMock,
}))

import { POST } from "@/app/api/operation-catalog/route"

function createAdminStub() {
  const inserts: Array<{ table: string; values: unknown }> = []

  return {
    inserts,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            return Promise.resolve({ error: null })
          },
        }
      },
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
  })
})
