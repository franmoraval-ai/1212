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

  it("queues session start when the API is temporarily unavailable even if the device is online", async () => {
    const supabase = createSupabaseStub()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ error: "Service unavailable" }),
    })
    vi.stubGlobal("fetch", fetchMock)

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

  it("quarantines dependent event/finish to dead-letter when start fails permanently (no silent loss)", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const supabase = createSupabaseStub()

    const startResult = await startRoundSessionWithOffline(supabase, {
      roundId: "round-1",
      roundName: "Ronda Norte",
      postName: "Puesto Norte",
      officerId: "officer-1",
      officerName: "Oficial Uno",
      startedAt: "2026-03-31T10:00:00.000Z",
      checkpointsTotal: 3,
    })
    const localSessionId = String(startResult.sessionId)

    await sendRoundEventForSessionWithOffline(supabase, {
      sessionId: localSessionId,
      roundId: "round-1",
      checkpointId: "cp-1",
      eventType: "checkpoint_match",
      capturedAt: "2026-03-31T10:05:00.000Z",
    })
    await finishRoundSessionWithOffline(supabase, {
      sessionId: localSessionId,
      endedAt: "2026-03-31T10:20:00.000Z",
      status: "completed",
      checkpointsCompleted: 3,
      checkpointsTotal: 3,
      reportId: "report-1",
    })
    expect(getOfflineRoundSessionQueueSize()).toBe(3)

    // Back online, but the server permanently rejects the start (e.g. lost auth/permission).
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: "Permiso denegado para iniciar la sesión." }),
    })
    vi.stubGlobal("fetch", fetchMock)

    // First flush drops the start; event/finish still have the start in the queue snapshot, so they wait.
    const firstFlush = await flushOfflineRoundSessionOperations(supabase)
    expect(firstFlush.dropped).toBe(1)
    expect(getDroppedOfflineRoundSessionQueueSize()).toBe(1)
    expect(getOfflineRoundSessionQueueSize()).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // Second flush finds no pending start, so the orphaned event/finish are quarantined too.
    const secondFlush = await flushOfflineRoundSessionOperations(supabase)
    expect(secondFlush.dropped).toBe(2)
    expect(getOfflineRoundSessionQueueSize()).toBe(0)
    // All three operations are preserved in dead-letter — nothing is silently lost.
    expect(getDroppedOfflineRoundSessionQueueSize()).toBe(3)
    // No extra network calls for local orphaned operations.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("treats an already-closed session (409) on finish as a successful sync (idempotent)", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const supabase = createSupabaseStub()

    const startResult = await startRoundSessionWithOffline(supabase, {
      roundId: "round-1",
      roundName: "Ronda Norte",
      postName: "Puesto Norte",
      officerId: "officer-1",
      officerName: "Oficial Uno",
      startedAt: "2026-03-31T10:00:00.000Z",
      checkpointsTotal: 2,
    })
    const localSessionId = String(startResult.sessionId)
    await finishRoundSessionWithOffline(supabase, {
      sessionId: localSessionId,
      endedAt: "2026-03-31T10:20:00.000Z",
      status: "completed",
      checkpointsCompleted: 2,
      checkpointsTotal: 2,
      reportId: "report-1",
    })

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ sessionId: "server-session-1" }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "La sesión ya está cerrada." }) })
    vi.stubGlobal("fetch", fetchMock)

    const flushResult = await flushOfflineRoundSessionOperations(supabase)

    expect(flushResult.synced).toBe(2)
    expect(flushResult.dropped).toBe(0)
    expect(getOfflineRoundSessionQueueSize()).toBe(0)
    expect(getDroppedOfflineRoundSessionQueueSize()).toBe(0)
  })

  it("retries a connectivity failure and only drops the start after the retry limit", async () => {
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false })
    const supabase = createSupabaseStub()

    await startRoundSessionWithOffline(supabase, {
      roundId: "round-1",
      roundName: "Ronda Norte",
      postName: "Puesto Norte",
      officerId: "officer-1",
      officerName: "Oficial Uno",
      startedAt: "2026-03-31T10:00:00.000Z",
      checkpointsTotal: 1,
    })

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true })
    const fetchMock = vi.fn().mockRejectedValue(new Error("Failed to fetch"))
    vi.stubGlobal("fetch", fetchMock)

    // The queue tolerates up to 8 attempts before quarantining a connectivity failure.
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      const flush = await flushOfflineRoundSessionOperations(supabase)
      expect(flush.dropped).toBe(0)
      expect(flush.pending).toBe(1)
      expect(getOfflineRoundSessionQueueSize()).toBe(1)
    }

    const finalFlush = await flushOfflineRoundSessionOperations(supabase)
    expect(finalFlush.dropped).toBe(1)
    expect(getOfflineRoundSessionQueueSize()).toBe(0)
    expect(getDroppedOfflineRoundSessionQueueSize()).toBe(1)
  })

  it("de-duplicates identical checkpoint events in the queue", async () => {
    const supabase = createSupabaseStub()
    const localSessionId = createOfflineRoundSessionId()

    const event = {
      sessionId: localSessionId,
      roundId: "round-1",
      checkpointId: "cp-1",
      eventType: "checkpoint_match",
      capturedAt: "2026-03-31T10:05:00.000Z",
    }

    await sendRoundEventForSessionWithOffline(supabase, event)
    await sendRoundEventForSessionWithOffline(supabase, event)

    expect(getOfflineRoundSessionQueueSize()).toBe(1)
  })
})