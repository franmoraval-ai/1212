import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  createOfflineRoundSessionId,
  finishRoundSessionWithOffline,
  flushOfflineRoundSessionOperations,
  getDroppedOfflineRoundSessionQueueSize,
  getOfflineRoundSessionQueueSize,
  resolveOfflineRoundSessionId,
  sendRoundEventForSessionWithOffline,
  startRoundSessionWithOffline,
} from "@/lib/offline-round-session-ops"

type SupabaseAuthStub = {
  getSession: ReturnType<typeof vi.fn>
  refreshSession: ReturnType<typeof vi.fn>
}

function createSupabaseStub() {
  const auth: SupabaseAuthStub = {
    getSession: vi.fn(async () => ({ data: { session: { access_token: "token-123" } } })),
    refreshSession: vi.fn(async () => ({ data: { session: { access_token: "token-123" } } })),
  }

  return {
    auth,
  } as unknown as Parameters<typeof startRoundSessionWithOffline>[0]
}

describe("offline round session ops", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    Object.defineProperty(window.navigator, "onLine", {
      configurable: true,
      value: true,
    })
  })

  it("queues a round session start while offline", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const supabase = createSupabaseStub()

    const result = await startRoundSessionWithOffline(supabase, {
      roundId: "round-1",
      roundName: "Ronda Norte",
      postName: "Puesto Norte",
      officerId: "officer-1",
      officerName: "Oficial Uno",
      startedAt: "2026-03-31T10:00:00.000Z",
      checkpointsTotal: 5,
    })

    expect(result.ok).toBe(true)
    expect(result.queued).toBe(true)
    expect(String(result.sessionId)).toContain("local-round-session-")
    expect(getOfflineRoundSessionQueueSize()).toBe(1)
  })

  it("queues checkpoint events against a local offline session", async () => {
    const supabase = createSupabaseStub()
    const localSessionId = createOfflineRoundSessionId()

    const result = await sendRoundEventForSessionWithOffline(supabase, {
      sessionId: localSessionId,
      roundId: "round-1",
      checkpointId: "cp-1",
      checkpointName: "Checkpoint 1",
      eventType: "checkpoint_match",
      capturedAt: "2026-03-31T10:05:00.000Z",
    })

    expect(result.ok).toBe(true)
    expect(result.queued).toBe(true)
    expect(getOfflineRoundSessionQueueSize()).toBe(1)
  })

  it("flushes queued start, event and finish in order and maps the local session id", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const supabase = createSupabaseStub()

    const startResult = await startRoundSessionWithOffline(supabase, {
      roundId: "round-1",
      roundName: "Ronda Norte",
      postName: "Puesto Norte",
      officerId: "officer-1",
      officerName: "Oficial Uno",
      startedAt: "2026-03-31T10:00:00.000Z",
      checkpointsTotal: 5,
    })

    const localSessionId = String(startResult.sessionId)
    await sendRoundEventForSessionWithOffline(supabase, {
      sessionId: localSessionId,
      roundId: "round-1",
      checkpointId: "cp-1",
      checkpointName: "Checkpoint 1",
      eventType: "checkpoint_match",
      capturedAt: "2026-03-31T10:05:00.000Z",
    })
    await finishRoundSessionWithOffline(supabase, {
      sessionId: localSessionId,
      endedAt: "2026-03-31T10:20:00.000Z",
      status: "completed",
      checkpointsCompleted: 5,
      checkpointsTotal: 5,
      reportId: "report-1",
    })

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sessionId: "server-session-1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) })
    vi.stubGlobal("fetch", fetchMock)

    const flushResult = await flushOfflineRoundSessionOperations(supabase)

    expect(flushResult.synced).toBe(3)
    expect(flushResult.pending).toBe(0)
    expect(getOfflineRoundSessionQueueSize()).toBe(0)
    expect(resolveOfflineRoundSessionId(localSessionId)).toBe("server-session-1")
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/rounds/sessions/server-session-1/event",
      expect.objectContaining({ method: "POST" })
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "/api/rounds/sessions/server-session-1/finish",
      expect.objectContaining({ method: "POST" })
    )
  })

  it("drops orphan local session operations during flush", async () => {
    const supabase = createSupabaseStub()
    const localSessionId = createOfflineRoundSessionId()

    await sendRoundEventForSessionWithOffline(supabase, {
      sessionId: localSessionId,
      roundId: "round-1",
      checkpointId: "cp-orphan",
      checkpointName: "Checkpoint Huérfano",
      eventType: "checkpoint_match",
      capturedAt: "2026-03-31T10:05:00.000Z",
    })

    const result = await flushOfflineRoundSessionOperations(supabase)

    expect(result.dropped).toBe(1)
    expect(getOfflineRoundSessionQueueSize()).toBe(0)
    expect(getDroppedOfflineRoundSessionQueueSize()).toBe(1)
  })
})