import { beforeEach, describe, expect, it, vi } from "vitest"

const { createRequestSupabaseClientMock, getBearerTokenFromRequestMock, getAuthenticatedActorMock } = vi.hoisted(() => ({
  createRequestSupabaseClientMock: vi.fn(),
  getBearerTokenFromRequestMock: vi.fn(() => "token"),
  getAuthenticatedActorMock: vi.fn(),
}))

vi.mock("@/lib/request-supabase", () => ({
  createRequestSupabaseClient: createRequestSupabaseClientMock,
  getBearerTokenFromRequest: getBearerTokenFromRequestMock,
}))
vi.mock("@/lib/server-auth", () => ({ getAuthenticatedActor: getAuthenticatedActorMock }))

import { GET } from "@/app/api/header/notifications/route"

function createBuilder(calls: Array<{ method: string; args: unknown[] }>, rows: unknown[] = [], count = 0) {
  const builder: Record<string, any> = {
    select: vi.fn((...args: unknown[]) => { calls.push({ method: "select", args }); return builder }),
    order: vi.fn((...args: unknown[]) => { calls.push({ method: "order", args }); return builder }),
    limit: vi.fn((...args: unknown[]) => { calls.push({ method: "limit", args }); return builder }),
    neq: vi.fn((...args: unknown[]) => { calls.push({ method: "neq", args }); return builder }),
    lt: vi.fn((...args: unknown[]) => { calls.push({ method: "lt", args }); return builder }),
    eq: vi.fn((...args: unknown[]) => { calls.push({ method: "eq", args }); return builder }),
    in: vi.fn((...args: unknown[]) => { calls.push({ method: "in", args }); return builder }),
    or: vi.fn((...args: unknown[]) => { calls.push({ method: "or", args }); return builder }),
    then: (resolve: (value: { data: unknown[]; count: number; error: null }) => unknown) => Promise.resolve(resolve({ data: rows, count, error: null })),
  }
  return builder
}

describe("/api/header/notifications", () => {
  beforeEach(() => vi.clearAllMocks())

  it("ignores client scope parameters and derives L1 scope from the actor", async () => {
    const clientTables: string[] = []
    const noteCalls: Array<{ method: string; args: unknown[] }> = []
    const client = {
      from: vi.fn((table: string) => {
        clientTables.push(table)
        return createBuilder(table === "internal_notes" ? noteCalls : [])
      }),
    }
    const findingCalls: Array<{ method: string; args: unknown[] }> = []
    const admin = { from: vi.fn(() => createBuilder(findingCalls)) }
    createRequestSupabaseClientMock.mockReturnValue(client)
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l1", userId: "actor-l1", email: "actor@demo.test", assigned: "Casa Pavas", roleLevel: 1 },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/header/notifications?includeFraud=1&noteScope=all&userId=evil&email=evil@example.test", {
      headers: { Authorization: "Bearer token" },
    }))

    expect(response.status).toBe(200)
    expect(clientTables).not.toContain("round_reports")
    expect(noteCalls).toContainEqual({
      method: "or",
      args: ["reported_by_user_id.eq.actor-l1,reported_by_email.eq.actor@demo.test"],
    })
    expect(findingCalls).toContainEqual({ method: "eq", args: ["responsible_user_id", "actor-l1"] })
  })

  it("includes only escalated findings delivered to the actor with a current due-date snapshot", async () => {
    const client = { from: vi.fn(() => createBuilder([])) }
    const currentDueAt = "2026-05-01T12:00:00.000Z"
    const staleDueAt = "2026-05-02T12:00:00.000Z"
    let findingsQuery = 0
    const admin = {
      from: vi.fn((table: string) => {
        if (table === "supervision_finding_escalation_deliveries") {
          return createBuilder([], [
            { finding_id: "finding-current", due_at_snapshot: currentDueAt },
            { finding_id: "finding-stale", due_at_snapshot: staleDueAt },
          ])
        }
        findingsQuery += 1
        if (findingsQuery === 1) return createBuilder([], [])
        if (findingsQuery === 2) return createBuilder([], [], 0)
        return createBuilder([], [
          { id: "finding-current", responsible_user_id: "l2-user", due_at: currentDueAt, status: "ABIERTO" },
          { id: "finding-stale", responsible_user_id: "l2-user", due_at: "2026-05-03T12:00:00.000Z", status: "ABIERTO" },
        ])
      }),
    }
    createRequestSupabaseClientMock.mockReturnValue(client)
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l4", userId: "director-l4", email: "director@demo.test", assigned: "", roleLevel: 4 },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/header/notifications", {
      headers: { Authorization: "Bearer token" },
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.assignedFindings.map((finding: { id: string }) => finding.id)).toEqual(["finding-current"])
    expect(body.assignedFindingsCount).toBe(1)
  })
})