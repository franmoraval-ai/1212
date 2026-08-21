import { beforeEach, describe, expect, it, vi } from "vitest"

const { loadManagedTeamScopeMock } = vi.hoisted(() => ({
  loadManagedTeamScopeMock: vi.fn(),
}))

vi.mock("@/lib/manager-hierarchy", () => ({
  loadManagedTeamScope: (...args: unknown[]) => loadManagedTeamScopeMock(...args),
}))

import { loadCommandOperationCatalog } from "@/lib/station-command-scope"

function actor(roleLevel: number) {
  return {
    uid: `auth-l${roleLevel}`,
    userId: `user-l${roleLevel}`,
    email: `l${roleLevel}@demo.test`,
    firstName: `Nivel ${roleLevel}`,
    status: "Activo",
    assigned: "BCR | Casa Pavas",
    roleLevel,
    customPermissions: [],
  }
}

function queryResult(data: unknown[]) {
  const state = { inValues: [] as string[] }
  const chain = {
    select() { return chain },
    order() { return chain },
    in(_column: string, values: string[]) {
      state.inValues = values
      return chain
    },
    eq() { return chain },
    then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
    },
  }
  return { chain, state }
}

describe("loadCommandOperationCatalog", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("loads L3 stations assigned directly or through managed users", async () => {
    const query = queryResult([
      {
        is_active: true,
        valid_from: null,
        valid_to: null,
        operation_catalog: { id: "post-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
      },
      {
        is_active: true,
        valid_from: null,
        valid_to: null,
        operation_catalog: { id: "post-2", operation_name: "INS", client_name: "Heredia", is_active: true },
      },
    ])
    const admin = { from: vi.fn(() => query.chain) }
    loadManagedTeamScopeMock.mockResolvedValue({
      scope: { userIds: new Set(["managed-l1"]), emails: new Set(["managed@demo.test"]) },
      error: null,
    })

    const result = await loadCommandOperationCatalog(admin, actor(3))

    expect(result.error).toBeNull()
    expect(result.rows.map((row) => row.id)).toEqual(["post-1", "post-2"])
    expect(query.state.inValues).toEqual(["user-l3", "managed-l1"])
  })

  it("adds operations assigned through L3 por cuenta without a duplicate direct authorization", async () => {
    const directQuery = queryResult([])
    const accountQuery = queryResult([{
      is_active: true,
      operation_catalog: { id: "post-account", operation_name: "BAC", client_name: "Escazu", is_active: true },
    }])
    const admin = {
      from: vi.fn((table: string) => table === "l2_account_manager_assignments" ? accountQuery.chain : directQuery.chain),
    }
    loadManagedTeamScopeMock.mockResolvedValue({
      scope: { userIds: new Set(), emails: new Set() },
      error: null,
    })

    const result = await loadCommandOperationCatalog(admin, actor(3))

    expect(result.error).toBeNull()
    expect(result.rows).toEqual([
      expect.objectContaining({ id: "post-account", operation_name: "BAC", client_name: "Escazu" }),
    ])
    expect(admin.from).toHaveBeenCalledWith("l2_account_manager_assignments")
  })

  it("loads the complete active and inactive catalog for L4", async () => {
    const query = queryResult([
      { id: "post-1", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
      { id: "post-2", operation_name: "INS", client_name: "Heredia", is_active: false },
    ])
    const admin = { from: vi.fn(() => query.chain) }

    const result = await loadCommandOperationCatalog(admin, actor(4))

    expect(result.rows).toHaveLength(2)
    expect(admin.from).toHaveBeenCalledWith("operation_catalog")
    expect(loadManagedTeamScopeMock).not.toHaveBeenCalled()
  })
})
