import { describe, expect, it } from "vitest"
import { mergeSupervisionReports, normalizeSupervisionRow } from "../supervision-context-helpers"

describe("use-supervision-context helpers", () => {
  it("normalizes queued supervision rows to camelCase", () => {
    expect(normalizeSupervisionRow({
      id: "abc",
      created_at: "2026-04-22T10:00:00.000Z",
      officer_name: "Oficial Uno",
      review_post: "Puesto Norte",
      supervisor_id: "supervisor@demo.com",
    })).toEqual({
      id: "abc",
      createdAt: "2026-04-22T10:00:00.000Z",
      officerName: "Oficial Uno",
      reviewPost: "Puesto Norte",
      supervisorId: "supervisor@demo.com",
    })
  })

  it("keeps queued and optimistic rows visible while preferring remote rows once available", () => {
    const merged = mergeSupervisionReports(
      [
        { id: "remote-1", createdAt: "2026-04-22T10:05:00.000Z", status: "CUMPLIM" },
        { id: "same-id", createdAt: "2026-04-22T10:04:00.000Z", status: "REMOTE" },
      ],
      [
        { id: "optimistic-1", createdAt: "2026-04-22T10:06:00.000Z", status: "OPTIMISTIC" },
        { id: "same-id", createdAt: "2026-04-22T10:04:00.000Z", status: "OPTIMISTIC" },
      ],
      [
        { id: "queued-1", createdAt: "2026-04-22T10:07:00.000Z", status: "PENDIENTE", isPendingSync: true },
      ]
    )

    expect(merged.map((row) => row.id)).toEqual(["queued-1", "optimistic-1", "remote-1", "same-id"])
    expect(merged.find((row) => row.id === "same-id")?.status).toBe("REMOTE")
  })
})