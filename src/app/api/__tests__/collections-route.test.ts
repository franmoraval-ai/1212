import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isDirectorMock,
  getBearerTokenFromRequestMock,
  createRequestSupabaseClientMock,
} = vi.hoisted(() => ({
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

import { GET } from "@/app/api/collections/[table]/route"

function createRequestClientStub() {
  const calls: Array<{ table: string; select: string; orderBy?: string; ascending?: boolean; range?: [number, number] }> = []

  return {
    calls,
    client: {
      from(table: string) {
        return {
          select(selectClause: string) {
            const state: { table: string; select: string; orderBy?: string; ascending?: boolean; range?: [number, number] } = {
              table,
              select: selectClause,
            }

            const builder = {
              range(from: number, to: number) {
                state.range = [from, to]
                return builder
              },
              order(column: string, options: { ascending: boolean }) {
                state.orderBy = column
                state.ascending = options.ascending
                return builder
              },
              then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                calls.push(state)
                return Promise.resolve({ data: [{ id: "inc-1" }], error: null }).then(onFulfilled, onRejected)
              },
            }

            return builder
          },
        }
      },
    },
  }
}

describe("/api/collections/[table]", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rejects invalid select columns with 400", async () => {
    const stub = createRequestClientStub()
    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)

    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
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

    const response = await GET(new Request("http://localhost/api/collections/incidents?select=id,drop_table"), {
      params: Promise.resolve({ table: "incidents" }),
    })

    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ error: "Select inválido para la colección solicitada." })
    expect(stub.calls).toEqual([])
  })

  it("rejects invalid orderBy columns with 400", async () => {
    const stub = createRequestClientStub()
    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)

    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
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

    const response = await GET(new Request("http://localhost/api/collections/incidents?select=id,status&orderBy=password"), {
      params: Promise.resolve({ table: "incidents" }),
    })

    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toMatchObject({ error: "orderBy inválido para la colección solicitada." })
    expect(stub.calls).toEqual([])
  })

  it("expands wildcard select to table whitelist and applies bounded range", async () => {
    const stub = createRequestClientStub()
    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)

    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
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

    const response = await GET(new Request("http://localhost/api/collections/incidents?select=*&orderBy=created_at&orderDesc=true&limit=20&offset=40"), {
      params: Promise.resolve({ table: "incidents" }),
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ rows: [{ id: "inc-1" }] })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]?.table).toBe("incidents")
    expect(stub.calls[0]?.select).toContain("id")
    expect(stub.calls[0]?.select).toContain("created_at")
    expect(stub.calls[0]?.orderBy).toBe("created_at")
    expect(stub.calls[0]?.ascending).toBe(false)
    expect(stub.calls[0]?.range).toEqual([40, 59])
  })

  it("allows users.manager_user_id in explicit select", async () => {
    const stub = createRequestClientStub()
    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)

    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
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

    const response = await GET(new Request("http://localhost/api/collections/users?select=id,manager_user_id"), {
      params: Promise.resolve({ table: "users" }),
    })

    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ rows: [{ id: "inc-1" }] })
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]?.table).toBe("users")
    expect(stub.calls[0]?.select).toContain("manager_user_id")
  })
})
