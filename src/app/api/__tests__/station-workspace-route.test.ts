import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  getBearerTokenFromRequestMock,
  createRequestSupabaseClientMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  getBearerTokenFromRequestMock: vi.fn(() => "token"),
  createRequestSupabaseClientMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/request-supabase", () => ({
  getBearerTokenFromRequest: getBearerTokenFromRequestMock,
  createRequestSupabaseClient: createRequestSupabaseClientMock,
}))

import { GET } from "@/app/api/station/workspace/route"

function createActor() {
  return {
    uid: "auth-l1",
    userId: "local-l1",
    email: "oficial@demo.test",
    firstName: "Oficial L1",
    status: "Activo",
    assigned: "BCR | Casa Pavas",
    roleLevel: 1,
    customPermissions: [],
  }
}

function createStationWorkspaceClientStub() {
  const notesQueries: Array<{ mode: "count" | "rows"; inValues: unknown[]; limit: number | null }> = []
  const roundReportInValues: unknown[][] = []

  return {
    notesQueries,
    roundReportInValues,
    client: {
      from(table: string) {
        if (table === "rounds") {
          return {
            select() {
              const builder = {
                order() {
                  return builder
                },
                then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                  return Promise.resolve({
                    data: [
                      { id: "round-1", name: "Ronda Casa Pavas", post: "Casa Pavas", status: "Activa", frequency: "30 min" },
                      { id: "round-2", name: "Ronda Matriz", post: "Casa Matriz", status: "Activa", frequency: "60 min" },
                    ],
                    error: null,
                  }).then(onFulfilled, onRejected)
                },
              }
              return builder
            },
          }
        }

        if (table === "round_reports") {
          return {
            select() {
              const state = { inValues: [] as unknown[] }
              const builder = {
                in(_column: string, values: unknown[]) {
                  state.inValues = values
                  roundReportInValues.push(values)
                  return builder
                },
                order() {
                  return builder
                },
                then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                  return Promise.resolve({
                    data: state.inValues.includes("round-1")
                      ? [{ id: "report-1", round_id: "round-1", round_name: "Ronda Casa Pavas", created_at: "2026-04-17T10:00:00.000Z" }]
                      : [],
                    error: null,
                  }).then(onFulfilled, onRejected)
                },
              }
              return builder
            },
          }
        }

        if (table === "internal_notes") {
          return {
            select(_columns: string, options?: { count?: string; head?: boolean }) {
              const state = {
                inValues: [] as unknown[],
                limit: null as number | null,
                mode: options?.head ? "count" as const : "rows" as const,
              }
              const builder = {
                neq() {
                  return builder
                },
                in(_column: string, values: unknown[]) {
                  state.inValues = values
                  return builder
                },
                order() {
                  return builder
                },
                limit(value: number) {
                  state.limit = value
                  return builder
                },
                then(onFulfilled?: (value: { data?: unknown[] | null; count?: number | null; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                  notesQueries.push({ mode: state.mode, inValues: state.inValues, limit: state.limit })
                  return Promise.resolve(
                    state.mode === "count"
                      ? { count: 5, error: null }
                      : {
                          data: [
                            { id: "note-1", priority: "alta", detail: "Puerta abierta", reported_by_name: "Oficial", post_name: "Casa Pavas", created_at: "2026-04-17T11:00:00.000Z" },
                            { id: "note-2", priority: "media", detail: "Luz dañada", reported_by_name: "Operador", post_name: "Casa Pavas", created_at: "2026-04-17T09:00:00.000Z" },
                          ],
                          error: null,
                        },
                  ).then(onFulfilled, onRejected)
                },
              }
              return builder
            },
          }
        }

        if (table === "incidents") {
          return {
            select() {
              const builder = {
                order() {
                  return builder
                },
                limit() {
                  return builder
                },
                then(onFulfilled?: (value: { data: unknown[]; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                  return Promise.resolve({
                    data: [
                      { id: "incident-1", status: "Abierto", priority_level: "Alta", incident_type: "Acceso", description: "Zona A", location: "Casa Pavas - Zona A", lugar: null, time: "2026-04-17T12:00:00.000Z", created_at: "2026-04-17T12:00:00.000Z" },
                      { id: "incident-2", status: "Abierto", priority_level: "Media", incident_type: "Acceso", description: "Matriz", location: "Casa Matriz", lugar: null, time: "2026-04-17T08:00:00.000Z", created_at: "2026-04-17T08:00:00.000Z" },
                    ],
                    error: null,
                  }).then(onFulfilled, onRejected)
                },
              }
              return builder
            },
          }
        }

        throw new Error(`Unexpected table ${table}`)
      },
    },
  }
}

describe("/api/station/workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("scopes round reports by visible rounds and reduces internal note payloads to count + recent rows", async () => {
    const stub = createStationWorkspaceClientStub()
    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)
    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
      actor: createActor(),
      error: null,
      status: 200,
    })

    const response = await GET(new Request("http://localhost/api/station/workspace?stationOperationName=BCR&stationPostName=Casa%20Pavas&stationLabel=Casa%20Pavas"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(stub.roundReportInValues).toEqual([["round-1"]])
    expect(stub.notesQueries).toEqual([
      { mode: "count", inValues: ["Casa Pavas"], limit: null },
      { mode: "rows", inValues: ["Casa Pavas"], limit: 3 },
    ])
    expect(body).toMatchObject({
      openNotesCount: 5,
      openIncidentsCount: 1,
      recentStationNotes: [
        { id: "note-1", reportedByName: "Oficial" },
        { id: "note-2", reportedByName: "Operador" },
      ],
      recentStationIncidents: [
        { id: "incident-1", locationLabel: "Casa Pavas - Zona A" },
      ],
    })
    expect(body.roundCards).toHaveLength(1)
    expect(body.roundCards[0].id).toBe("round-1")
    expect(body.roundCards[0].dueAtMs).toBe(new Date("2026-04-17T10:00:00.000Z").getTime() + 30 * 60 * 1000)
  })
})