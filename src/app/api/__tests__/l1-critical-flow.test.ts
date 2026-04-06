/**
 * L1 Critical Flow Smoke Tests
 *
 * Validates the essential L1 officer workflow:
 *   1. Shift creation (clock-in)
 *   2. Round session start (begin patrol)
 *   3. Round bulletin / report submission
 *   4. Incident report creation
 *
 * These tests use the same mock pattern as other route tests but chain
 * them in sequence to ensure the full L1 path works end-to-end.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

// ── Mocks ────────────────────────────────────────────────────────────
const {
  getAuthenticatedActorMock,
  isDirectorMock,
  isOfficerAuthorizedForStationMock,
  loadAuthorizedOfficersForStationMock,
  loadStationProfileForStationMock,
} = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
  isOfficerAuthorizedForStationMock: vi.fn(),
  loadAuthorizedOfficersForStationMock: vi.fn(),
  loadStationProfileForStationMock: vi.fn(),
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

import { POST as createShift } from "@/app/api/shifts/route"
import { POST as startRoundSession } from "@/app/api/rounds/sessions/start/route"
import { POST as createRoundReport } from "@/app/api/round-reports/route"
import { POST as createIncident } from "@/app/api/incidents/route"

// ── Fixtures ─────────────────────────────────────────────────────────
function createL1Actor() {
  return {
    uid: "auth-l1-smoke",
    userId: "local-l1-smoke",
    email: "oficial@demo.test",
    firstName: "Oficial",
    status: "Activo",
    assigned: "BCR | Casa Pavas",
    roleLevel: 1,
    customPermissions: [],
  }
}

function makeRequest(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ── Per-test admin stub ──────────────────────────────────────────────
function createAdminStub() {
  const inserts: Array<{ table: string; values: unknown }> = []

  // Chainable query builder that resolves to empty data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function chainableBuilder(table: string, resolveData?: unknown): Record<string, any> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: Record<string, any> = {}
    builder.eq = () => builder
    builder.in = () => builder
    builder.is = () => builder
    builder.ilike = () => builder
    builder.order = () => builder
    builder.limit = () => builder
    builder.single = () => Promise.resolve({ data: resolveData ?? null, error: null })
    builder.maybeSingle = () => {
      if (table === "rounds") {
        return Promise.resolve({
          data: { id: "round-1", name: "Ronda Norte", post: "Casa Pavas", status: "Activa" },
          error: null,
        })
      }
      return Promise.resolve({ data: null, error: null })
    }
    builder.then = (resolve: (v: unknown) => void) =>
      resolve({ data: resolveData !== undefined ? resolveData : [], error: null })
    return builder
  }

  return {
    inserts,
    client: {
      from(table: string) {
        return {
          insert(values: unknown) {
            inserts.push({ table, values })
            return {
              select() {
                return chainableBuilder(table, { id: "new-row-id" })
              },
              then: (resolve: (v: unknown) => void) => resolve({ error: null }),
            }
          },
          select() {
            return chainableBuilder(table)
          },
          update(values: unknown) {
            return {
              eq(_column: string, _value: unknown) {
                inserts.push({ table: `${table}:update`, values })
                return Promise.resolve({ error: null })
              },
            }
          },
        }
      },
    },
  }
}

function setupL1Auth(adminClient: unknown) {
  getAuthenticatedActorMock.mockResolvedValue({
    admin: adminClient,
    actor: createL1Actor(),
    error: null,
    status: 200,
  })
  isOfficerAuthorizedForStationMock.mockResolvedValue({ ok: true, isAuthorized: true, source: "station_officer_authorizations" })
  loadStationProfileForStationMock.mockResolvedValue(null)
  loadAuthorizedOfficersForStationMock.mockResolvedValue([
    { userId: "local-l1-smoke", name: "Oficial", email: "oficial@demo.test" },
  ])
}

// ── Tests ────────────────────────────────────────────────────────────

describe("L1 Critical Flow Smoke Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("Step 1 — shift route authorizes L1 officer for station", async () => {
    const admin = createAdminStub()
    setupL1Auth(admin.client)

    // The shift route is deeply stateful (attendance logs, officer roster).
    // Its full CRUD is tested in shifts-route.test.ts.
    // Here we verify that auth + station authorization passes (non-401/403).
    const response = await createShift(
      makeRequest("http://localhost/api/shifts", {
        action: "check_in",
        stationLabel: "BCR | Casa Pavas",
        stationPostName: "Casa Pavas",
        officerUserId: "local-l1-smoke",
        officerName: "Oficial",
      }),
    )

    // Should not return 401 or 403 — auth and station authorization passed
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(403)
  })

  it("Step 2 — round session route authorizes L1 officer for round", async () => {
    const admin = createAdminStub()
    setupL1Auth(admin.client)

    // The round_sessions start route is tested in round-session-start-route.test.ts.
    // Here we verify auth + station authorization passes (non-401/403).
    const response = await startRoundSession(
      makeRequest("http://localhost/api/rounds/sessions/start", {
        roundId: "round-1",
        stationLabel: "BCR | Casa Pavas",
        officerName: "Oficial",
        postName: "Casa Pavas",
      }),
    )

    // Should not return 401 or 403
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(403)
  })

  it("Step 3 — L1 officer submits a round report (bulletin)", async () => {
    const admin = createAdminStub()
    setupL1Auth(admin.client)

    const response = await createRoundReport(
      makeRequest("http://localhost/api/round-reports", {
        id: "report-smoke-1",
        round_name: "Ronda Norte",
        post_name: "Casa Pavas",
        status: "COMPLETA",
        checkpoints: [{ name: "Punto 1", scanned: true }],
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true })
    // The route must stamp the authenticated actor uid on the inserted row
    const reportInsert = admin.inserts.find((i) => i.table === "round_reports")
    expect(reportInsert).toBeDefined()
    expect((reportInsert?.values as Record<string, unknown>)?.officer_id).toBe("auth-l1-smoke")
  })

  it("Step 4 — L1 officer reports an incident", async () => {
    const admin = createAdminStub()
    setupL1Auth(admin.client)

    const response = await createIncident(
      makeRequest("http://localhost/api/incidents", {
        incidentType: "Alerta de seguridad",
        description: "Puerta trasera abierta",
        location: "Casa Pavas - Zona A",
      }),
    )

    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({ ok: true })
  })

  it("rejects unauthenticated requests across all L1 endpoints", async () => {
    getAuthenticatedActorMock.mockResolvedValue({
      admin: null,
      actor: null,
      error: "Not authenticated",
      status: 401,
    })

    const endpoints = [
      () => createShift(makeRequest("http://localhost/api/shifts", {})),
      () => startRoundSession(makeRequest("http://localhost/api/rounds/sessions/start", { roundId: "x" })),
      () => createRoundReport(makeRequest("http://localhost/api/round-reports", { id: "x" })),
      () => createIncident(makeRequest("http://localhost/api/incidents", { id: "x" })),
    ]

    for (const call of endpoints) {
      const response = await call()
      expect(response.status).toBeGreaterThanOrEqual(401)
    }
  })
})
