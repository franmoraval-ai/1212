import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { flushOfflineMutations, getQueuedOfflineMutationsByTable, runMutationWithOffline } from "@/lib/offline-mutations"

function setOffline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    value: !value,
  })
}

describe("offline mutations", () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
    vi.useRealTimers()
    setOffline(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("dedupes recent offline inserts even when only audit timestamps change", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-01T10:00:00.000Z"))

    const request = {
      table: "incidents",
      action: "insert" as const,
      payload: {
        location: "Casa Pavas",
        description: "Novedad breve",
        createdAt: "2026-04-01T10:00:00.000Z",
      },
    }

    await runMutationWithOffline({} as never, request)

    vi.setSystemTime(new Date("2026-04-01T10:00:30.000Z"))
    await runMutationWithOffline({} as never, {
      ...request,
      payload: {
        ...request.payload,
        createdAt: "2026-04-01T10:00:30.000Z",
      },
    })

    expect(getQueuedOfflineMutationsByTable("incidents")).toHaveLength(1)
  })

  it("allows the same insert again after the dedupe window expires", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-04-01T11:00:00.000Z"))

    const request = {
      table: "internal_notes",
      action: "insert" as const,
      payload: {
        post_name: "Casa Pavas",
        detail: "Puerta verificada",
      },
    }

    await runMutationWithOffline({} as never, request)

    vi.setSystemTime(new Date("2026-04-01T11:03:00.000Z"))
    await runMutationWithOffline({} as never, request)

    expect(getQueuedOfflineMutationsByTable("internal_notes")).toHaveLength(2)
  })

  it("queues round reports when the backend is temporarily unavailable even if the device is online", async () => {
    setOffline(false)

    const supabase = {
      from: vi.fn(() => ({
        insert: vi.fn(async () => ({ error: { message: "Service unavailable" } })),
      })),
    } as never

    const result = await runMutationWithOffline(supabase, {
      table: "round_reports",
      action: "insert",
      payload: {
        id: "report-1",
        round_id: "round-1",
        officer_id: "auth-user-1",
      },
    })

    expect(result).toMatchObject({ ok: true, queued: true })
    expect(getQueuedOfflineMutationsByTable("round_reports")).toHaveLength(1)
  })

  it("flushes round reports before lower priority offline mutations", async () => {
    setOffline(true)

    await runMutationWithOffline({} as never, {
      table: "incidents",
      action: "insert",
      payload: { id: "incident-1", description: "Novedad" },
    })
    await runMutationWithOffline({} as never, {
      table: "round_reports",
      action: "insert",
      payload: { id: "report-1", round_id: "round-1", officer_id: "auth-user-1" },
    })

    setOffline(false)
    const executionOrder: string[] = []
    const supabase = {
      from: vi.fn((table: string) => ({
        insert: vi.fn(async () => {
          executionOrder.push(table)
          return { error: null }
        }),
      })),
    } as never

    const result = await flushOfflineMutations(supabase)

    expect(result).toMatchObject({ synced: 2, pending: 0, dropped: 0 })
    expect(executionOrder).toEqual(["round_reports", "incidents"])
  })
})