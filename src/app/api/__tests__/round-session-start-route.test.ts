import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isOfficerAuthorizedForStationMock,
  loadStationProfileForStationMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isOfficerAuthorizedForStationMock: vi.fn(),
  loadStationProfileForStationMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
}))

vi.mock("@/lib/station-officer-authorizations", () => ({
  isOfficerAuthorizedForStation: isOfficerAuthorizedForStationMock,
}))

vi.mock("@/lib/station-profiles", () => ({
  loadStationProfileForStation: loadStationProfileForStationMock,
  isStationProfilesSchemaMissing: (message: string) => String(message ?? "").toLowerCase().includes("station_profiles"),
}))

import { POST } from "@/app/api/rounds/sessions/start/route"

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

function createRoundsAdminStub() {
  let insertedPayload: Record<string, unknown> | null = null

  return {
    getInsertedPayload: () => insertedPayload,
    client: {
      from(table: string) {
        if (table === "rounds") {
          return {
            select() {
              const builder = {
                eq() {
                  return builder
                },
                limit() {
                  return builder
                },
                maybeSingle() {
                  return Promise.resolve({
                    data: { id: "round-1", name: "Ronda Pavas", post: "Casa Pavas", status: "Activa" },
                    error: null,
                  })
                },
              }
              return builder
            },
          }
        }

        if (table === "round_sessions") {
          return {
            select() {
              const builder = {
                eq() {
                  return builder
                },
                limit() {
                  return builder
                },
                maybeSingle() {
                  return Promise.resolve({ data: null, error: null })
                },
              }
              return builder
            },
            insert(values: Record<string, unknown>) {
              insertedPayload = values
              return {
                select() {
                  return {
                    single() {
                      return Promise.resolve({ data: { id: "session-1" }, error: null })
                    },
                  }
                },
              }
            },
          }
        }

        return {
          select() {
            const builder = {
              eq() {
                return builder
              },
              limit() {
                return builder
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: null })
              },
            }
            return builder
          },
        }
      },
    },
  }
}

describe("/api/rounds/sessions/start", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns 503 when station authorization schema is missing for L1", async () => {
    const admin = createRoundsAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: createActor(),
      error: null,
      status: 200,
    })
    isOfficerAuthorizedForStationMock.mockResolvedValue({
      ok: false,
      error: 'relation "station_officer_authorizations" does not exist',
      isAuthorized: false,
      source: "schema-missing",
    })

    const response = await POST(new Request("http://localhost/api/rounds/sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId: "round-1",
        startedAt: "2026-04-01T15:00:00.000Z",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body.error).toBe("Aplique la migración supabase/add_station_officer_authorizations.sql antes de operar rondas L1 por puesto.")
  })

  it("starts a round session when the officer is authorized and the station profile is enabled", async () => {
    const admin = createRoundsAdminStub()
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: createActor(),
      error: null,
      status: 200,
    })
    isOfficerAuthorizedForStationMock.mockResolvedValue({
      ok: true,
      error: null,
      isAuthorized: true,
      source: "catalog",
      operationCatalogId: "catalog-1",
    })
    loadStationProfileForStationMock.mockResolvedValue({
      ok: true,
      error: null,
      record: {
        id: "profile-1",
        operationCatalogId: "catalog-1",
        operationName: "BCR",
        postName: "Casa Pavas",
        catalogIsActive: true,
        isEnabled: true,
        deviceLabel: "TABLET PAVAS",
        notes: null,
        registeredAt: null,
        updatedAt: null,
      },
    })

    const response = await POST(new Request("http://localhost/api/rounds/sessions/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roundId: "round-1",
        checkpointsTotal: 7,
        startedAt: "2026-04-01T15:10:00.000Z",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, sessionId: "session-1" })
    expect(admin.getInsertedPayload()).toMatchObject({
      round_id: "round-1",
      round_name: "Ronda Pavas",
      post_name: "Casa Pavas",
      officer_id: "auth-l1",
      officer_name: "Oficial L1",
      status: "in_progress",
      checkpoints_total: 7,
      checkpoints_completed: 0,
      started_at: "2026-04-01T15:10:00.000Z",
      last_scan_at: "2026-04-01T15:10:00.000Z",
    })
  })
})