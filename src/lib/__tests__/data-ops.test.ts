import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { fetchDataOpsRows } from "@/lib/data-ops"

describe("fetchDataOpsRows", () => {
  it("paginates beyond Supabase's 1,000-row response ceiling", async () => {
    const sourceRows = Array.from({ length: 2280 }, (_, index) => ({
      id: `supervision-${index}`,
      created_at: `2026-03-${String((index % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
    }))
    const ranges: Array<[number, number]> = []
    const query = {
      order: vi.fn(),
      range: vi.fn((from: number, to: number) => {
        ranges.push([from, to])
        return Promise.resolve({ data: sourceRows.slice(from, to + 1), error: null })
      }),
    }
    query.order.mockReturnValue(query)

    const admin = {
      from: vi.fn(() => ({
        select: vi.fn(() => query),
      })),
    } as unknown as SupabaseClient

    const rows = await fetchDataOpsRows(admin, "supervisions", "live", { limit: 10000 })

    expect(rows).toHaveLength(2280)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
})