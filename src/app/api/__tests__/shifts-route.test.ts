import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isOfficerAuthorizedForStationMock,
  loadAuthorizedOfficersForStationMock,
  loadStationProfileForStationMock,
  isDirectorMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isOfficerAuthorizedForStationMock: vi.fn(),
  loadAuthorizedOfficersForStationMock: vi.fn(),
  loadStationProfileForStationMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

vi.mock("@/lib/station-officer-authorizations", () => ({
  isOfficerAuthorizedForStation: isOfficerAuthorizedForStationMock,
  loadAuthorizedOfficersForStation: loadAuthorizedOfficersForStationMock,
}))

vi.mock("@/lib/station-profiles", () => ({
  loadStationProfileForStation: loadStationProfileForStationMock,
  isStationProfilesSchemaMissing: (message: string) => String(message ?? "").toLowerCase().includes("station_profiles"),
}))

import { GET, POST } from "@/app/api/shifts/route"

function createActor() {
  return {
    uid: "auth-user-1",
    userId: "local-user-1",
    email: "oficial@demo.test",
    firstName: "Oficial",
    status: "Activo",
    assigned: "BCR | Casa Pavas",
    roleLevel: 1,
    customPermissions: [],
  }
}

function createDirectorActor() {
  return {
    uid: "auth-l4",
    userId: "local-l4",
    email: "director@demo.test",
    firstName: "Directora",
    status: "Activo",
    assigned: null,
    roleLevel: 4,
    customPermissions: [],
  }
}

function createAttendanceAdminStub() {
  const updates: Array<{ values: Record<string, unknown>; eq: Array<{ column: string; value: unknown }> }> = []

  return {
    updates,
    client: {
      from(table: string) {
        if (table === "attendance_logs") {
          return {
            select() {
              const state: { in?: unknown[]; eq?: Array<{ column: string; value: unknown }> } = {}
              const builder = {
                in(_column: string, values: unknown[]) {
                  state.in = values
                  return builder
                },
                is() {
                  return builder
                },
                order() {
                  return builder
                },
                limit() {
                  return builder
                },
                then(onFulfilled?: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                  return Promise.resolve({
                    data: [{
                      id: "shift-1",
                      station_label: "bcr__casa-pavas",
                      station_post_name: "Casa Pavas",
                      officer_user_id: "officer-1",
                      officer_name: "Oficial Uno",
                      officer_email: "uno@demo.test",
                      check_in_at: "2026-04-01T12:00:00.000Z",
                      check_out_at: null,
                      worked_minutes: null,
                      notes: "Turno abierto por falla de red",
                      created_by_device_email: "tablet@demo.test",
                      created_at: "2026-04-01T12:00:00.000Z",
                    }],
                    error: null,
                  }).then(onFulfilled, onRejected)
                },
              }
              return builder
            },
            update(values: Record<string, unknown>) {
              const state = { values, eq: [] as Array<{ column: string; value: unknown }> }
              const builder = {
                eq(column: string, value: unknown) {
                  state.eq.push({ column, value })
                  updates.push(state)
                  return Promise.resolve({ error: null })
                },
              }
              return builder
            },
          }
        }

        return {
          select() {
            const builder = {
              eq() {
                return builder
              },
              maybeSingle() {
                return Promise.resolve({ data: null, error: null })
              },
              in() {
                return builder
              },
              is() {
                return builder
              },
              order() {
                return builder
              },
              limit() {
                return builder
              },
              then(onFulfilled?: (value: { data: unknown; error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
                return Promise.resolve({ data: [], error: null }).then(onFulfilled, onRejected)
              },
            }
            return builder
          },
        }
      },
    },
  }
}

describe("/api/shifts", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadAuthorizedOfficersForStationMock.mockResolvedValue({ rows: [], error: null, source: "catalog" })
  })

  it("returns 503 when station authorization schema is missing on GET", async () => {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: {},
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

    const response = await GET(new Request("http://localhost/api/shifts?stationLabel=Casa%20Pavas&stationPostName=Casa%20Pavas"))
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toMatchObject({
      error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de operar puestos L1.",
    })
  })

  it("returns 403 with station profile details when the operational post is paused", async () => {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: {},
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
        isEnabled: false,
        deviceLabel: "TABLET CASA PAVAS",
        notes: "Pausado por mantenimiento",
        registeredAt: null,
        updatedAt: null,
      },
    })

    const response = await POST(new Request("http://localhost/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_in",
        stationLabel: "Casa Pavas",
        stationPostName: "Casa Pavas",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe("Este puesto está pausado para L1 operativo. Reactívelo en Centro Operativo.")
    expect(body.stationProfile).toMatchObject({
      id: "profile-1",
      isEnabled: false,
      deviceLabel: "TABLET CASA PAVAS",
    })
  })

  it("allows L4 to close an open shift manually and appends an audit note", async () => {
    const admin = createAttendanceAdminStub()
    isOfficerAuthorizedForStationMock.mockResolvedValue({
      ok: true,
      error: null,
      isAuthorized: true,
      source: "catalog",
      operationCatalogId: "catalog-1",
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: createDirectorActor(),
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_out",
        stationLabel: "Casa Pavas",
        stationPostName: "Casa Pavas",
        activeShiftId: "shift-1",
        notes: "Cierre manual por contingencia operativa.",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, activeShift: null })
    expect(admin.updates).toHaveLength(1)
    expect(admin.updates[0]?.eq).toContainEqual({ column: "id", value: "shift-1" })
    expect(String(admin.updates[0]?.values.notes ?? "")).toContain("Turno abierto por falla de red")
    expect(String(admin.updates[0]?.values.notes ?? "")).toContain("Cierre manual L4 por director@demo.test")
    expect(String(admin.updates[0]?.values.notes ?? "")).toContain("Cierre manual por contingencia operativa.")
  })

  it("allows L1 to close the active shift even when the local shift id is stale and the station is paused", async () => {
    const admin = createAttendanceAdminStub()
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
        isEnabled: false,
        deviceLabel: "TABLET CASA PAVAS",
        notes: "Pausado por horario diurno",
        registeredAt: null,
        updatedAt: null,
      },
    })
    getAuthenticatedActorMock.mockResolvedValue({
      admin: admin.client,
      actor: createActor(),
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "check_out",
        stationLabel: "Casa Pavas",
        stationPostName: "Casa Pavas",
        activeShiftId: "shift-local-stale",
      }),
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ ok: true, activeShift: null })
    expect(admin.updates).toHaveLength(1)
    expect(admin.updates[0]?.eq).toContainEqual({ column: "id", value: "shift-1" })
    expect(String(admin.updates[0]?.values.notes ?? "")).toContain("turno solicitado shift-local-stale")
    expect(String(admin.updates[0]?.values.notes ?? "")).toContain("turno activo real shift-1")
  })
})