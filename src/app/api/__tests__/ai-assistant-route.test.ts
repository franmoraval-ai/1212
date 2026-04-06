import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedActorMock, isDirectorMock } = vi.hoisted(() => ({
  getAuthenticatedActorMock: vi.fn(),
  isDirectorMock: vi.fn((actor: { roleLevel?: number } | null) => Number(actor?.roleLevel ?? 0) >= 4),
}))

vi.mock("@/lib/server-auth", () => ({
  getAuthenticatedActor: getAuthenticatedActorMock,
  isDirector: isDirectorMock,
}))

vi.mock("@/lib/openai-server", () => ({
  getOpenAIUrl: () => "https://openai.example.test/v1",
  getOpenAITimeoutSignal: () => undefined,
}))

import { POST } from "@/app/api/ai/assistant/route"

type QueryResult = { data?: unknown; error?: { message?: string } | null }

function createStreamingResponse(tokens: string[]) {
  const encoder = new TextEncoder()
  const payload = tokens.map((token) => `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`).join("") + "data: [DONE]\n\n"
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload))
      controller.close()
    },
  })

  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

function createAiAdminStub(resolver: (table: string, state: Record<string, unknown>) => QueryResult) {
  return {
    from(table: string) {
      const state: Record<string, unknown> = { table }
      const builder = {
        select(fields: string) {
          state.select = fields
          return builder
        },
        insert(values: unknown) {
          state.insert = values
          return Promise.resolve(resolver(table, state))
        },
        eq(column: string, value: unknown) {
          state[`eq:${column}`] = value
          return builder
        },
        ilike(column: string, value: unknown) {
          state[`ilike:${column}`] = value
          return builder
        },
        is(column: string, value: unknown) {
          state[`is:${column}`] = value
          return builder
        },
        gte(column: string, value: unknown) {
          state[`gte:${column}`] = value
          return builder
        },
        lte(column: string, value: unknown) {
          state[`lte:${column}`] = value
          return builder
        },
        order(column: string, value: unknown) {
          state[`order:${column}`] = value
          return builder
        },
        limit(value: number) {
          state.limit = value
          return builder
        },
        range(from: number, to: number) {
          state.range = [from, to]
          return Promise.resolve(resolver(table, state))
        },
        maybeSingle() {
          const result = resolver(table, state)
          const single = Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null)
          return Promise.resolve({ data: single, error: result.error ?? null })
        },
        then(onFulfilled?: (value: { data: unknown; error: { message?: string } | null }) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: resolver(table, state).data ?? [], error: resolver(table, state).error ?? null }).then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

describe("/api/ai/assistant", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("OPENAI_API_KEY", "test-key")
  })

  it("creates an internal note through the low-risk action path", async () => {
    const inserts: unknown[] = []
    const admin = createAiAdminStub((table, state) => {
      if (table === "internal_notes") {
        inserts.push(state.insert)
        return { data: null, error: null }
      }
      return { data: [], error: null }
    })

    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisor Demo",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "crear nota interna puesto: Casa Pavas prioridad alta detalle: Puerta lateral sin sello y requiere revisión inmediata" },
        ],
      }),
    }))

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("✅ Nota interna creada correctamente.")
    expect(inserts).toEqual([
      expect.objectContaining({
        post_name: "Casa Pavas",
        priority: "alta",
        reported_by_user_id: "auth-l2",
        reported_by_email: "supervisor@demo.test",
      }),
    ])
  })

  it("filters the AI context to the assigned scope before calling OpenAI", async () => {
    let openAiBody: Record<string, unknown> | null = null
    vi.stubGlobal("fetch", vi.fn(async (_input, init) => {
      openAiBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      return createStreamingResponse(["Resumen listo"])
    }))

    const admin = createAiAdminStub((table) => {
      if (table === "users") {
        return { data: [{ id: "auth-l2", email: "supervisor@demo.test", first_name: "Supervisor Demo" }], error: null }
      }
      if (table === "operation_catalog") {
        return {
          data: [
            { created_at: "2026-04-01T10:00:00.000Z", operation_name: "BCR", client_name: "Casa Pavas", is_active: true },
            { created_at: "2026-04-01T10:00:00.000Z", operation_name: "OTRA", client_name: "Casa Matriz", is_active: true },
          ],
          error: null,
        }
      }
      if (table === "rounds") {
        return {
          data: [
            { created_at: "2026-04-01T09:00:00.000Z", name: "Ronda Pavas", post: "Casa Pavas", puesto_base: "Casa Pavas", status: "Activa", frequency: 60 },
            { created_at: "2026-04-01T09:00:00.000Z", name: "Ronda Matriz", post: "Casa Matriz", puesto_base: "Casa Matriz", status: "Activa", frequency: 60 },
          ],
          error: null,
        }
      }
      if (table === "incidents") {
        return {
          data: [
            { created_at: "2026-04-01T08:00:00.000Z", incident_type: "Puerta", location: "Casa Pavas", lugar: null, status: "Abierto", description: "Incidente en Pavas", reported_by_user_id: null, reported_by_email: null },
            { created_at: "2026-04-01T08:30:00.000Z", incident_type: "Puerta", location: "Casa Matriz", lugar: null, status: "Abierto", description: "Incidente en Matriz", reported_by_user_id: null, reported_by_email: null },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    })

    getAuthenticatedActorMock.mockResolvedValue({
      admin,
      actor: {
        uid: "auth-l2",
        userId: "local-l2",
        email: "supervisor@demo.test",
        firstName: "Supervisor Demo",
        status: "Activo",
        assigned: "BCR | Casa Pavas",
        roleLevel: 2,
        customPermissions: [],
      },
      error: null,
      status: 200,
    })

    const response = await POST(new Request("http://localhost/api/ai/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Dame un resumen general de hoy" },
        ],
      }),
    }))

    const text = await response.text()
    const systemMessage = ((openAiBody?.messages as Array<{ role: string; content: string }> | undefined) ?? []).find((message) => message.role === "system")?.content ?? ""

    expect(response.status).toBe(200)
    expect(text).toContain("Resumen listo")
    expect(systemMessage).toContain("Casa Pavas")
    expect(systemMessage).not.toContain("Incidente en Matriz")
    expect(systemMessage).not.toContain("Casa Matriz")
  })
})