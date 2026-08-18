import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isDirectorMock,
  loadManagedTeamScopeMock,
  loadActorSupervisionScopesMock,
  canViewSupervisionRecordMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number }) => Number(actor.roleLevel ?? 0) >= 4),
  loadManagedTeamScopeMock: vi.fn(),
  loadActorSupervisionScopesMock: vi.fn(),
  canViewSupervisionRecordMock: vi.fn((_actor, _team, row: Record<string, unknown>) => row.review_post === "Casa Pavas"),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))
vi.mock("@/lib/manager-hierarchy", () => ({ loadManagedTeamScope: loadManagedTeamScopeMock }))
vi.mock("@/lib/supervision-visibility", () => ({
  loadActorSupervisionScopes: loadActorSupervisionScopesMock,
  canViewSupervisionRecord: canViewSupervisionRecordMock,
}))

import { GET, PATCH } from "@/app/api/supervision-findings/route"

function createAdminStub() {
  const updates: unknown[] = []
  const rows = [
    {
      id: "finding-visible",
      severity: "ALTA",
      status: "ABIERTO",
      supervision: { id: "sup-visible", review_post: "Casa Pavas", supervisor_id: "owner@demo.test" },
    },
    {
      id: "finding-hidden",
      severity: "MEDIA",
      status: "ABIERTO",
      supervision: { id: "sup-hidden", review_post: "Otro Puesto", supervisor_id: "other@demo.test" },
    },
  ]
  const builder: Record<string, any> = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(async () => ({ data: rows, error: null })),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })),
    update: vi.fn((values: unknown) => {
      updates.push(values)
      return builder
    }),
    then: (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })),
  }
  return { from: vi.fn(() => builder), updates }
}

describe("/api/supervision-findings", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadManagedTeamScopeMock.mockResolvedValue({ scope: {}, error: null })
    loadActorSupervisionScopesMock.mockResolvedValue(["BCR | Casa Pavas"])
  })

  it("returns only findings whose supervision is visible to L2", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l2", userId: "local-l2", email: "owner@demo.test", assigned: "BCR | Casa Pavas", roleLevel: 2 },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/supervision-findings"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.findings).toEqual([
      expect.objectContaining({ id: "finding-visible", canManage: true }),
    ])
    expect(canViewSupervisionRecordMock).toHaveBeenCalledTimes(2)
  })

  it("allows L3 to close a finding inside the account scope", async () => {
    const admin = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l3", userId: "local-l3", email: "manager@demo.test", assigned: "BCR | Casa Pavas", roleLevel: 3 },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/supervision-findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finding_id: "finding-visible", status: "CERRADO", corrective_action: "Uniforme entregado." }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toContainEqual(expect.objectContaining({
      status: "CERRADO",
      corrective_action: "Uniforme entregado.",
      verified_by_user_id: "local-l3",
    }))
  })
})