import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  createRequestSupabaseClientMock,
  getAuthenticatedActorMock,
  loadActorSupervisionScopesMock,
  loadManagedTeamScopeMock,
  canViewSupervisionRecordMock,
} = vi.hoisted(() => ({
  createRequestSupabaseClientMock: vi.fn(),
  getAuthenticatedActorMock: vi.fn(),
  loadActorSupervisionScopesMock: vi.fn(),
  loadManagedTeamScopeMock: vi.fn(),
  canViewSupervisionRecordMock: vi.fn(),
}))

vi.mock("@/lib/request-supabase", () => ({
  createRequestSupabaseClient: (...args: unknown[]) => createRequestSupabaseClientMock(...args),
  getBearerTokenFromRequest: () => "token-l2",
}))
vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: (...args: unknown[]) => getAuthenticatedActorMock(...args),
}))
vi.mock("@/lib/manager-hierarchy", () => ({
  createEmptyManagedTeamScope: () => ({ userIds: new Set(), emails: new Set() }),
  loadManagedTeamScope: (...args: unknown[]) => loadManagedTeamScopeMock(...args),
}))
vi.mock("@/lib/supervision-visibility", () => ({
  canViewSupervisionRecord: (...args: unknown[]) => canViewSupervisionRecordMock(...args),
  loadActorSupervisionScopes: (...args: unknown[]) => loadActorSupervisionScopesMock(...args),
}))

import { GET } from "@/app/api/overview/route"

function createClientStub() {
  const selects: Array<{ table: string; clause: string }> = []
  const orFilters: string[] = []
  const client = {
    from(table: string) {
      let selectClause = ""
      const builder = {
        select(clause: string) {
          selectClause = clause
          selects.push({ table, clause })
          return builder
        },
        order() { return builder },
        gte() { return builder },
        lt() { return builder },
        or(filter: string) {
          orFilters.push(filter)
          return builder
        },
        then(resolve: (value: { data: unknown[]; error: null }) => unknown) {
          if (table === "supervisions") {
            return Promise.resolve(resolve({
              data: [
                {
                  id: "sup-visible",
                  created_at: "2026-08-20T01:00:00.000Z",
                  event_occurred_at: "2026-08-19T16:00:00.000Z",
                  review_post: "Casa Pavas",
                  operation_name: "BCR",
                  supervisor_id: "l2-user",
                },
                {
                  id: "sup-hidden",
                  created_at: "2026-08-19T17:00:00.000Z",
                  event_occurred_at: "2026-08-19T17:00:00.000Z",
                  review_post: "Fuera",
                  operation_name: "OTRA",
                  supervisor_id: "other-user",
                },
              ],
              error: null,
            }))
          }
          return Promise.resolve(resolve({ data: [], error: null }))
        },
      }
      return builder
    },
  }
  return { client, selects, orFilters }
}

describe("/api/overview", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadActorSupervisionScopesMock.mockResolvedValue(["BCR | Casa Pavas"])
    loadManagedTeamScopeMock.mockResolvedValue({ scope: { userIds: new Set(), emails: new Set() }, error: null })
    canViewSupervisionRecordMock.mockImplementation((_actor, _team, row: { id?: string }) => row.id === "sup-visible")
  })

  it("counts L2-visible supervision events by event_occurred_at", async () => {
    const requestStub = createClientStub()
    const adminStub = createClientStub()
    createRequestSupabaseClientMock.mockReturnValue(requestStub.client)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: adminStub.client,
      actor: {
        uid: "l2-user",
        userId: "l2-user",
        email: "l2@demo.test",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/overview?from=2026-08-19T06:00:00.000Z&to=2026-08-20T06:00:00.000Z"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.supervisions).toEqual([
      expect.objectContaining({
        id: "sup-visible",
        createdAt: "2026-08-20T01:00:00.000Z",
        eventOccurredAt: "2026-08-19T16:00:00.000Z",
      }),
    ])
    expect(adminStub.selects).toContainEqual(expect.objectContaining({
      table: "supervisions",
      clause: expect.stringContaining("event_occurred_at"),
    }))
    expect(requestStub.selects.some(({ table }) => table === "supervisions")).toBe(false)
    expect(adminStub.orFilters[0]).toContain("event_occurred_at.gte.2026-08-19T06:00:00.000Z")
    expect(canViewSupervisionRecordMock).toHaveBeenCalledTimes(2)
  })
})
