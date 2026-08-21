import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock, createRequestSupabaseClientMock, getBearerTokenFromRequestMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  createRequestSupabaseClientMock: vi.fn(),
  getBearerTokenFromRequestMock: vi.fn(() => "token-demo"),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

vi.mock("@/lib/request-supabase", () => ({
  createRequestSupabaseClient: createRequestSupabaseClientMock,
  getBearerTokenFromRequest: getBearerTokenFromRequestMock,
}))

import { GET } from "@/app/api/supervision/context/route"

function createClientStub() {
  const filters: Array<{ column: string; value: unknown }> = []

  const client = {
    from(table: string) {
      return {
        select() {
          const builder = {
            eq(column: string, value: unknown) {
              filters.push({ column, value })
              return builder
            },
            in(column: string, value: unknown) {
              filters.push({ column, value })
              return builder
            },
            maybeSingle() {
              return Promise.resolve({ data: null, error: null })
            },
            order() {
              if (table === "supervisions") {
                return {
                  limit() {
                    return Promise.resolve({
                      data: [
                        {
                          id: "sup-l4-scope",
                          operation_name: "BCR",
                          review_post: "Casa Pavas",
                          supervisor_id: "l4@demo.test",
                        },
                        {
                          id: "sup-outside",
                          operation_name: "Otro cliente",
                          review_post: "Otro puesto",
                          supervisor_id: "otro@demo.test",
                        },
                      ],
                      error: null,
                    })
                  },
                }
              }

              if (table === "personnel_registry") {
                return Promise.resolve({
                  data: [
                    { id: "officer-a", full_name: "Nombre Repetido", personnel_code: "HO-000101", linked_user_id: "user-a", status: "ACTIVO", source: "AUTH_USER", personnel_registry_assignments: [] },
                    { id: "officer-b", full_name: "Nombre Repetido", personnel_code: "HO-000102", linked_user_id: null, status: "ACTIVO", source: "PREREGISTRO", personnel_registry_assignments: [{ operation_catalog_id: "catalog-1", is_active: true }] },
                  ],
                  error: null,
                })
              }

              return Promise.resolve({ data: [], error: null })
            },
            then(callback: (result: { data: unknown[]; error: null }) => unknown) {
              if (table === "station_officer_authorizations") {
                const officerFilter = filters.find((item) => item.column === "officer_user_id")
                filters.length = 0
                return Promise.resolve(callback({
                  data: Array.isArray(officerFilter?.value) && officerFilter.value.includes("local-l3")
                    ? [{
                      is_active: true,
                      valid_from: null,
                      valid_to: null,
                      operation_catalog: { operation_name: "BCR", client_name: "Casa Pavas" },
                    }]
                    : [],
                  error: null,
                }))
              }

              if (table === "users") {
                filters.length = 0
                return Promise.resolve(callback({ data: [], error: null }))
              }

              filters.length = 0
              return Promise.resolve(callback({ data: [], error: null }))
            },
          }

          return builder
        },
      }
    },
  }

  return client
}

describe("/api/supervision/context", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("allows L3 to see same-scope supervisions from L4 even when assigned is empty", async () => {
    const client = createClientStub()
    createRequestSupabaseClientMock.mockReturnValue(client)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: client,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "l3@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: null,
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/supervision/context?includeReports=1&includeOperationCatalog=0&includeWeaponsCatalog=0"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0]).toMatchObject({
      id: "sup-l4-scope",
      operationName: "BCR",
      reviewPost: "Casa Pavas",
      supervisorId: "l4@demo.test",
    })
  })

  it("keeps officers with duplicate names distinct by UUID and personnel code", async () => {
    const client = createClientStub()
    createRequestSupabaseClientMock.mockReturnValue(client)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: client,
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

    const response = await GET(new Request("http://localhost/api/supervision/context?includeReports=0&includeOperationCatalog=0&includeWeaponsCatalog=0&includeOfficerDirectory=1"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.officerDirectory).toEqual([
      expect.objectContaining({ id: "officer-a", name: "Nombre Repetido", personnelCode: "HO-000101" }),
      expect.objectContaining({ id: "officer-b", name: "Nombre Repetido", personnelCode: "HO-000102", source: "PREREGISTRO", operationCatalogIds: ["catalog-1"] }),
    ])
  })

  it("uses admin candidates and explicit scope filtering for L3 report reads", async () => {
    const queryCounter = {
      adminSupervisions: 0,
      requestSupervisions: 0,
    }

    const adminClient = {
      from(table: string) {
        return {
          select() {
            const filters: Array<{ column: string; value: unknown }> = []
            const builder = {
              eq(column: string, value: unknown) {
                filters.push({ column, value })
                return builder
              },
              in(column: string, value: unknown) {
                filters.push({ column, value })
                return builder
              },
              then(callback: (result: { data: unknown[]; error: null }) => unknown) {
                if (table === "station_officer_authorizations") {
                  return Promise.resolve(callback({
                    data: [{
                      is_active: true,
                      valid_from: null,
                      valid_to: null,
                      operation_catalog: { operation_name: "BCR", client_name: "Casa Pavas" },
                    }],
                    error: null,
                  }))
                }

                if (table === "users") {
                  return Promise.resolve(callback({ data: [], error: null }))
                }

                return Promise.resolve(callback({ data: [], error: null }))
              },
              order() {
                if (table === "supervisions") {
                  queryCounter.adminSupervisions++
                }
                return {
                  limit() {
                    return Promise.resolve({
                      data: [{
                        id: "sup-l4-scope",
                        operation_name: "BCR",
                        review_post: "Casa Pavas",
                        supervisor_id: "l4@demo.test",
                      }, {
                        id: "sup-l4-outside",
                        operation_name: "INS",
                        review_post: "Heredia",
                        supervisor_id: "l4@demo.test",
                      }],
                      error: null,
                    })
                  },
                }
              },
            }

            return builder
          },
        }
      },
    }

    const requestClient = {
      from(table: string) {
        return {
          select() {
            return {
              order() {
                if (table === "supervisions") {
                  queryCounter.requestSupervisions++
                }

                return {
                  limit() {
                    return Promise.resolve({
                      data: [{
                        id: "sup-l3-scope",
                        operation_name: "BCR",
                        review_post: "Casa Pavas",
                        supervisor_id: "l3@demo.test",
                      }],
                      error: null,
                    })
                  },
                }
              },
            }
          },
        }
      },
    }

    createRequestSupabaseClientMock.mockReturnValue(requestClient)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: adminClient,
      actor: {
        uid: "auth-l3",
        userId: "local-l3",
        email: "l3@demo.test",
        firstName: "Gerente",
        status: "Activo",
        assigned: null,
        roleLevel: 3,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/supervision/context?includeReports=1&includeOperationCatalog=0&includeWeaponsCatalog=0"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0]).toMatchObject({ id: "sup-l4-scope", supervisorId: "l4@demo.test" })
    expect(queryCounter.requestSupervisions).toBe(0)
    expect(queryCounter.adminSupervisions).toBe(1)
  })
})