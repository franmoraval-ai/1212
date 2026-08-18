import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isDirectorMock,
  loadManagedTeamScopeMock,
  loadActorSupervisionScopesMock,
  canViewSupervisionRecordMock,
  canAlertOfficerMock,
  writeAuditEventMock,
  sendPushToUserIdsMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number }) => Number(actor.roleLevel ?? 0) >= 4),
  loadManagedTeamScopeMock: vi.fn(),
  loadActorSupervisionScopesMock: vi.fn(),
  canViewSupervisionRecordMock: vi.fn((_actor, _team, row: Record<string, unknown>) => row.review_post === "Casa Pavas"),
  canAlertOfficerMock: vi.fn((_actor, _team, target: { id: string }) => target.id === "user-in-scope"),
  writeAuditEventMock: vi.fn().mockResolvedValue(true),
  sendPushToUserIdsMock: vi.fn().mockResolvedValue({ sent: 1, removed: 0, targeted: 1 }),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))
vi.mock("@/lib/manager-hierarchy", () => ({ loadManagedTeamScope: loadManagedTeamScopeMock }))
vi.mock("@/lib/push-authorization", () => ({ canAlertOfficer: canAlertOfficerMock }))
vi.mock("@/lib/audit-log", () => ({ writeAuditEvent: writeAuditEventMock }))
vi.mock("@/lib/push-server", () => ({ sendPushToUserIds: sendPushToUserIdsMock }))
vi.mock("@/lib/supervision-visibility", () => ({
  loadActorSupervisionScopes: loadActorSupervisionScopesMock,
  canViewSupervisionRecord: canViewSupervisionRecordMock,
}))

import { GET, PATCH } from "@/app/api/supervision-findings/route"

function createAdminStub(visibleOverrides: Record<string, unknown> = {}) {
  const updates: unknown[] = []
  const rows = [
    {
      id: "finding-visible",
      severity: "ALTA",
      status: "ABIERTO",
      responsible_user_id: "user-in-scope",
      corrective_action: null,
      due_at: "2026-08-30T23:59:59.000Z",
      verified_by_user_id: null,
      verified_at: null,
      supervision: { id: "sup-visible", review_post: "Casa Pavas", supervisor_id: "owner@demo.test" },
      ...visibleOverrides,
    },
    {
      id: "finding-hidden",
      severity: "MEDIA",
      status: "ABIERTO",
      supervision: { id: "sup-hidden", review_post: "Otro Puesto", supervisor_id: "other@demo.test" },
    },
  ]
  const users = [
    { id: "user-in-scope", first_name: "Supervisor Uno", email: "uno@demo.test", role_level: 2, status: "Activo", assigned: "Casa Pavas" },
    { id: "user-out-scope", first_name: "Supervisor Dos", email: "dos@demo.test", role_level: 2, status: "Activo", assigned: "Otro Puesto" },
    { id: "user-l1", first_name: "Oficial L1", email: "l1@demo.test", role_level: 1, status: "Activo", assigned: "Casa Pavas" },
  ]
  const from = vi.fn((table: string) => {
    const builder: Record<string, any> = {
      select: vi.fn(() => builder),
      order: vi.fn(() => builder),
      limit: vi.fn(async () => ({ data: table === "users" ? users : rows, error: null })),
      eq: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })),
      update: vi.fn((values: unknown) => {
        updates.push(values)
        return builder
      }),
      then: (resolve: (value: { error: null }) => unknown) => Promise.resolve(resolve({ error: null })),
    }
    return builder
  })
  return { from, updates }
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
    expect(body.assignees).toEqual([
      expect.objectContaining({ id: "user-in-scope", label: "Supervisor Uno" }),
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
      body: JSON.stringify({
        finding_id: "finding-visible",
        status: "CERRADO",
        severity: "CRITICA",
        corrective_action: "Uniforme entregado.",
        responsible_user_id: "user-in-scope",
        due_at: "2026-08-30T23:59:59.000Z",
      }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toContainEqual(expect.objectContaining({
      status: "CERRADO",
      severity: "CRITICA",
      corrective_action: "Uniforme entregado.",
      responsible_user_id: "user-in-scope",
      due_at: "2026-08-30T23:59:59.000Z",
      verified_by_user_id: "local-l3",
    }))
    expect(writeAuditEventMock).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ userId: "local-l3" }),
      expect.objectContaining({ action: "supervision_finding.updated", resourceId: "finding-visible" }),
      expect.any(Request)
    )
  })

  it("rejects assigning a responsible user outside the actor scope", async () => {
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
      body: JSON.stringify({ finding_id: "finding-visible", status: "ABIERTO", severity: "ALTA", responsible_user_id: "user-out-scope" }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "El responsable está fuera de su ámbito autorizado." })
    expect(admin.updates).toEqual([])
  })

  it("notifies a newly assigned responsible user", async () => {
    const admin = createAdminStub({ responsible_user_id: null })
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l3", userId: "local-l3", email: "manager@demo.test", assigned: "BCR | Casa Pavas", roleLevel: 3 },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/supervision-findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finding_id: "finding-visible", responsible_user_id: "user-in-scope" }),
    }))

    expect(response.status).toBe(200)
    expect(sendPushToUserIdsMock).toHaveBeenCalledWith(admin, ["user-in-scope"], expect.objectContaining({
      url: "/supervision-findings",
      tag: "supervision-finding-finding-visible",
    }))
  })

  it("preserves assignment, due date, and severity on a legacy partial update", async () => {
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
      body: JSON.stringify({ finding_id: "finding-visible", status: "EN_EJECUCION", corrective_action: "En proceso." }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toContainEqual(expect.objectContaining({
      status: "EN_EJECUCION",
      severity: "ALTA",
      responsible_user_id: "user-in-scope",
      due_at: "2026-08-30T23:59:59.000Z",
    }))
    expect(sendPushToUserIdsMock).not.toHaveBeenCalled()
  })

  it("rejects an impossible calendar date", async () => {
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
      body: JSON.stringify({ finding_id: "finding-visible", due_at: "2026-02-30T23:59:59.000Z" }),
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: "La fecha límite no es válida." })
    expect(admin.updates).toEqual([])
  })

  it("preserves original verification when editing an already closed finding", async () => {
    const admin = createAdminStub({
      status: "CERRADO",
      corrective_action: "Corrección verificada.",
      verified_by_user_id: "original-verifier",
      verified_at: "2026-08-15T10:00:00.000Z",
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: { uid: "auth-l4", userId: "local-l4", email: "director@demo.test", assigned: "", roleLevel: 4 },
      error: null,
      status: 200,
    })

    const response = await PATCH(new Request("http://localhost/api/supervision-findings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ finding_id: "finding-visible", severity: "CRITICA" }),
    }))

    expect(response.status).toBe(200)
    expect(admin.updates).toContainEqual(expect.objectContaining({
      status: "CERRADO",
      verified_by_user_id: "original-verifier",
      verified_at: "2026-08-15T10:00:00.000Z",
    }))
  })
})