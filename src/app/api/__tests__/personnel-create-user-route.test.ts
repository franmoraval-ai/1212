import { beforeEach, describe, expect, it, vi } from "vitest"

const getAuthenticatedActorMock = vi.fn()
const writeAuditEventMock = vi.fn()
const validateL1AssignmentMock = vi.fn()
const ensureUniqueShiftNfcCodeMock = vi.fn()
const selectUserByNormalizedEmailMock = vi.fn()

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: (...args: unknown[]) => getAuthenticatedActorMock(...args),
  getAssignableRoleLimit: () => 4,
  hasCustomPermission: () => false,
  isDirector: () => true,
}))
vi.mock("@/lib/audit-log", () => ({ writeAuditEvent: (...args: unknown[]) => writeAuditEventMock(...args) }))
vi.mock("@/lib/personnel-assignment", () => ({ validateL1Assignment: (...args: unknown[]) => validateL1AssignmentMock(...args) }))
vi.mock("@/lib/shift-credentials", () => ({
  ensureUniqueShiftNfcCode: (...args: unknown[]) => ensureUniqueShiftNfcCodeMock(...args),
  hashShiftPin: () => "hashed-pin",
  normalizeShiftNfcCode: (value: unknown) => String(value ?? "").trim(),
}))
vi.mock("@/lib/users-email", () => ({ selectUserByNormalizedEmail: (...args: unknown[]) => selectUserByNormalizedEmailMock(...args) }))

import { POST } from "@/app/api/personnel/create-user/route"

function createAdminStub() {
  const insertedUsers: Array<Record<string, unknown>> = []
  const authorizationUpserts: unknown[] = []
  let registryRead = 0
  const authCreateUser = vi.fn().mockResolvedValue({ data: { user: { id: "auth-new" } }, error: null })
  const authDeleteUser = vi.fn().mockResolvedValue({ error: null })

  const admin = {
    auth: { admin: { createUser: authCreateUser, deleteUser: authDeleteUser } },
    from(table: string) {
      if (table === "personnel_registry") {
        const builder = {
          select() { return builder },
          eq() { return builder },
          maybeSingle() {
            registryRead += 1
            return Promise.resolve({
              data: registryRead === 1
                ? {
                    id: "registry-pre",
                    personnel_code: "HO-000019",
                    linked_user_id: null,
                    full_name: "Nombre Canónico",
                    status: "ACTIVO",
                    source: "PREREGISTRO",
                  }
                : { linked_user_id: "auth-new" },
              error: null,
            })
          },
        }
        return builder
      }

      if (table === "personnel_registry_assignments") {
        const builder = {
          select() { return builder },
          eq() { return builder },
          then(callback: (result: { data: Array<{ operation_catalog_id: string }>; error: null }) => unknown) {
            return Promise.resolve(callback({ data: [{ operation_catalog_id: "catalog-1" }], error: null }))
          },
        }
        return builder
      }

      if (table === "station_officer_authorizations") {
        return {
          upsert(values: unknown) {
            authorizationUpserts.push(values)
            return Promise.resolve({ error: null })
          },
        }
      }

      return {
        insert(values: Record<string, unknown>) {
          insertedUsers.push(values)
          return Promise.resolve({ error: null })
        },
        delete() {
          return { eq: () => Promise.resolve({ error: null }) }
        },
      }
    },
  }

  return { admin, insertedUsers, authorizationUpserts, authCreateUser, authDeleteUser }
}

function createRequest(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/personnel/create-user", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Nombre Manipulado",
      email: "oficial@hoseguridad.com",
      temporaryPassword: "Temporal9!",
      role_level: 1,
      status: "Activo",
      assigned: "BCR | Casa Pavas",
      personnelRegistryId: "registry-pre",
      ...overrides,
    }),
  })
}

describe("/api/personnel/create-user preregistration completion", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    validateL1AssignmentMock.mockResolvedValue({ ok: true })
    ensureUniqueShiftNfcCodeMock.mockResolvedValue({ ok: true })
    selectUserByNormalizedEmailMock.mockResolvedValue({ data: null })
  })

  it("creates the Auth account with the canonical preregistered identity", async () => {
    const stub = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: stub.admin,
      actor: { userId: "director", roleLevel: 4, customPermissions: [] },
      error: null,
      status: 200,
    })

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, personnelRegistryId: "registry-pre", personnelCode: "HO-000019" })
    expect(stub.authCreateUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "oficial@hoseguridad.com",
      user_metadata: { first_name: "Nombre Canónico" },
    }))
    expect(stub.insertedUsers).toContainEqual(expect.objectContaining({
      id: "auth-new",
      personnel_code: "HO-000019",
      first_name: "Nombre Canónico",
      role_level: 1,
    }))
    expect(stub.authorizationUpserts).toContainEqual([
      expect.objectContaining({ operation_catalog_id: "catalog-1", officer_user_id: "auth-new", is_active: true }),
    ])
    expect(stub.authDeleteUser).not.toHaveBeenCalled()
  })

  it("rejects completing a preregistration with a non-L1 role", async () => {
    const stub = createAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: stub.admin,
      actor: { userId: "director", roleLevel: 4, customPermissions: [] },
      error: null,
      status: 200,
    })

    const response = await POST(createRequest({ role_level: 2 }))

    expect(response.status).toBe(400)
    expect(stub.authCreateUser).not.toHaveBeenCalled()
  })
})
