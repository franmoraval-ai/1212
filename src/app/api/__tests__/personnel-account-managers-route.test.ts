import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock, writeAuditEventMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  writeAuditEventMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))
vi.mock("@/lib/audit-log", () => ({ writeAuditEvent: writeAuditEventMock }))

import { GET, POST } from "@/app/api/personnel/account-managers/route"

type Result = { data?: unknown; error?: { message?: string } | null }
type Mutation = { type: "upsert" | "update"; values: unknown; filters?: Record<string, unknown> }

function createAdmin(resolver: (table: string, state: Record<string, unknown>) => Result) {
  const mutations: Mutation[] = []
  return {
    mutations,
    client: {
      from(table: string) {
        const state: Record<string, unknown> = {}
        const builder: Record<string, any> = {
          select(fields: string) { state.select = fields; return builder },
          eq(column: string, value: unknown) { state[`eq:${column}`] = value; return builder },
          in(column: string, values: unknown[]) { state[`in:${column}`] = values; return builder },
          maybeSingle() {
            const result = resolver(table, state)
            const data = Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null)
            return Promise.resolve({ data, error: result.error ?? null })
          },
          upsert(values: unknown) {
            mutations.push({ type: "upsert", values })
            return Promise.resolve({ error: null })
          },
          update(values: unknown) {
            const filters: Record<string, unknown> = {}
            const updateBuilder: Record<string, any> = {
              eq(column: string, value: unknown) { filters[`eq:${column}`] = value; return updateBuilder },
              in(column: string, values: unknown[]) {
                filters[`in:${column}`] = values
                mutations.push({ type: "update", values, filters })
                return Promise.resolve({ error: null })
              },
            }
            return updateBuilder
          },
          then(resolve: (value: { data: unknown; error: { message?: string } | null }) => unknown) {
            const result = resolver(table, state)
            return Promise.resolve(resolve({ data: result.data ?? [], error: result.error ?? null }))
          },
        }
        return builder
      },
    },
  }
}

function request(method: "GET" | "POST", body?: unknown) {
  return new Request(`http://localhost/api/personnel/account-managers${method === "GET" ? "?userId=l2-1" : ""}`, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  })
}

describe("/api/personnel/account-managers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("rejects non-L4 actors", async () => {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: {},
      actor: { userId: "l3-actor", roleLevel: 3 },
      error: null,
      status: 200,
    })

    const response = await GET(request("GET"))

    expect(response.status).toBe(403)
  })

  it("returns active account assignments for an L2", async () => {
    const admin = createAdmin((table) => {
      if (table === "users") return { data: { id: "l2-1", role_level: 2 } }
      return { data: [{ operation_catalog_id: "account-1", l3_user_id: "l3-1", is_active: true }] }
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: { userId: "l4-actor", roleLevel: 4 },
      error: null,
      status: 200,
    })

    const response = await GET(request("GET"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assignments).toEqual([{ operationCatalogId: "account-1", l3UserId: "l3-1" }])
  })

  it("upserts one L3 per account and deactivates removed accounts", async () => {
    const admin = createAdmin((table, state) => {
      if (table === "users" && state["eq:id"]) return { data: { id: "l2-1", role_level: 2 } }
      if (table === "users") return { data: [{ id: "l3-1", role_level: 3, status: "Activo" }] }
      if (table === "operation_catalog") return { data: [{ id: "account-1" }] }
      if (table === "l2_account_manager_assignments") {
        return { data: [{ operation_catalog_id: "account-old", l3_user_id: "l3-1", is_active: true }] }
      }
      return { data: [] }
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: { userId: "l4-actor", roleLevel: 4 },
      error: null,
      status: 200,
    })

    const response = await POST(request("POST", {
      userId: "l2-1",
      assignments: [{ operationCatalogId: "account-1", l3UserId: "l3-1" }],
    }))

    expect(response.status).toBe(200)
    expect(admin.mutations).toContainEqual(expect.objectContaining({
      type: "upsert",
      values: [expect.objectContaining({ operation_catalog_id: "account-1", l2_user_id: "l2-1", l3_user_id: "l3-1", is_active: true })],
    }))
    expect(admin.mutations).toContainEqual(expect.objectContaining({
      type: "update",
      filters: { "eq:l2_user_id": "l2-1", "in:operation_catalog_id": ["account-old"] },
    }))
    expect(writeAuditEventMock).toHaveBeenCalledOnce()
  })
})
