import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAuthenticatedActorMock,
  isDirectorMock,
  createRequestSupabaseClientMock,
  getBearerTokenFromRequestMock,
} = vi.hoisted(() => ({
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

type QueryResult = {
  data: unknown[] | null
  error: { message?: string } | null
}

function createClientStub(resolver: (selectClause: string, limit: number) => QueryResult) {
  const roundReportsCalls: Array<{ selectClause: string; limit: number }> = []

  const client = {
    from(table: string) {
      return {
        select(selectClause: string) {
          const state = {
            selectClause,
            limit: 0,
          }

          const builder = {
            order() {
              return builder
            },
            limit(value: number) {
              state.limit = value
              return Promise.resolve((() => {
                if (table !== "round_reports") {
                  return { data: [], error: null }
                }

                roundReportsCalls.push({ selectClause: state.selectClause, limit: state.limit })
                return resolver(state.selectClause, state.limit)
              })())
            },
            then(callback: (result: { data: unknown[]; error: null }) => unknown) {
              return Promise.resolve(callback({ data: [], error: null }))
            },
          }

          return builder
        },
      }
    },
  }

  return { client, roundReportsCalls }
}

describe("/api/rounds/context", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it("uses summary report mode by default for lighter payloads", async () => {
    const stub = createClientStub(() => ({
      data: [{ id: "rr-summary-1", created_at: "2026-05-05T10:00:00.000Z", round_name: "Ronda Norte" }],
      error: null,
    }))

    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)
    const { GET } = await import("@/app/api/rounds/context/route")

    const response = await GET(new Request("http://localhost/api/rounds/context?includeReports=1&includeRounds=0&includeSecurityConfig=0&includeSessions=0&includeAuthorizedOperations=0"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports).toHaveLength(1)
    expect(stub.roundReportsCalls).toHaveLength(1)
    expect(stub.roundReportsCalls[0]?.selectClause.includes("checkpoint_logs")).toBe(false)
  })

  it("falls back from extended to stable report select without returning 500", async () => {
    const stub = createClientStub((selectClause) => {
      if (selectClause.includes("supervisor_name") && selectClause.includes("checkpoint_logs")) {
        return { data: null, error: { message: "column supervisor_name does not exist" } }
      }

      return {
        data: [{ id: "rr-1", created_at: "2026-05-05T10:00:00.000Z", round_name: "Ronda Norte" }],
        error: null,
      }
    })

    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)
    const { GET } = await import("@/app/api/rounds/context/route")

    const response = await GET(new Request("http://localhost/api/rounds/context?includeReports=1&includeRounds=0&includeSecurityConfig=0&includeSessions=0&includeAuthorizedOperations=0&reportMode=full"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0]).toMatchObject({ id: "rr-1", roundName: "Ronda Norte" })
    expect(Array.isArray(body.warnings)).toBe(true)
    expect((body.warnings as string[]).some((item) => item.startsWith("reports_extended_fallback:"))).toBe(true)
    expect(stub.roundReportsCalls).toHaveLength(2)
  })

  it("falls back to lean payload with safe limit when extended and stable fail", async () => {
    const stub = createClientStub((selectClause, limit) => {
      if (selectClause.includes("supervisor_name")) {
        return { data: null, error: { message: "extended failed" } }
      }

      if (selectClause.includes("checkpoint_logs")) {
        return { data: null, error: { message: "stable failed" } }
      }

      return {
        data: [{ id: "rr-lean-1", created_at: "2026-05-05T09:00:00.000Z", round_name: "Ronda Lean" }],
        error: null,
      }
    })

    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)
    const { GET } = await import("@/app/api/rounds/context/route")

    const response = await GET(new Request("http://localhost/api/rounds/context?includeReports=1&includeRounds=0&includeSecurityConfig=0&includeSessions=0&includeAuthorizedOperations=0&reportsLimit=1000&reportMode=full"))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.reports).toHaveLength(1)
    expect(body.reports[0]).toMatchObject({ id: "rr-lean-1", roundName: "Ronda Lean" })
    expect((body.warnings as string[]).some((item) => item === "reports_lean_payload_limit:200")).toBe(true)
    expect(stub.roundReportsCalls.map((call) => call.limit)).toEqual([1000, 1000, 200])
  })

  it("returns 500 when all report fallback queries fail", async () => {
    const stub = createClientStub(() => ({
      data: null,
      error: { message: "all fallbacks failed" },
    }))

    createRequestSupabaseClientMock.mockReturnValue(stub.client as never)
    const { GET } = await import("@/app/api/rounds/context/route")

    const response = await GET(new Request("http://localhost/api/rounds/context?includeReports=1&includeRounds=0&includeSecurityConfig=0&includeSessions=0&includeAuthorizedOperations=0&reportMode=full"))
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: "all fallbacks failed" })
    expect(stub.roundReportsCalls).toHaveLength(3)
  })
})
