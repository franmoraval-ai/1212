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
import { GET } from "@/app/api/operation-catalog/route"

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
  })

  it("returns only authorized operation rows for L2", async () => {
    createRequestSupabaseClientMock.mockReturnValue(createRequestClientStubForL2Authorized() as never)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
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
  })

  it("falls back to assigned scope for L2 when authorizations table is unavailable", async () => {
    createRequestSupabaseClientMock.mockReturnValue(createRequestClientStubForL2Fallback() as never)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "l2@demo.test",
        firstName: "Supervisor",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
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
          id: "BCR__CASA PAVAS",
          operationName: "BCR",
          clientName: "CASA PAVAS",
          isActive: true,
        },
      ],
    })
  })
})
