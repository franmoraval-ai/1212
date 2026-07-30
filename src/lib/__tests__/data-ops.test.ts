import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { buildExportPayload, fetchDataOpsRows } from "@/lib/data-ops"

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

  it("retries supervisions without optional analytical columns on older schemas", async () => {
    const selectedFields: string[] = []
    const query = {
      order: vi.fn(),
      range: vi.fn(() => {
        if (selectedFields.length === 1) {
          return Promise.resolve({ data: null, error: { message: "column officer_phone does not exist" } })
        }
        return Promise.resolve({ data: [{ id: "sup-1", created_at: "2026-07-30T12:00:00.000Z" }], error: null })
      }),
    }
    query.order.mockReturnValue(query)

    const admin = {
      from: vi.fn(() => ({
        select: vi.fn((fields: string) => {
          selectedFields.push(fields)
          return query
        }),
      })),
    } as unknown as SupabaseClient

    const rows = await fetchDataOpsRows(admin, "supervisions", "live", { limit: 1 })

    expect(rows).toEqual([{ id: "sup-1", created_at: "2026-07-30T12:00:00.000Z" }])
    expect(selectedFields).toHaveLength(2)
    expect(selectedFields[0]).toContain("officer_phone")
    expect(selectedFields[1]).not.toContain("officer_phone")
    expect(selectedFields[1]).not.toContain("evidence_bundle")
    expect(selectedFields[1]).not.toContain("geo_risk")
    expect(selectedFields[1]).not.toContain("operation_catalog_id")
  })

  it("exports the complete analytical supervision record without photo binaries", async () => {
    const payload = await buildExportPayload("supervisions", "live", "csv", [{
      id: "sup-1",
      created_at: "2026-07-30T12:00:00.000Z",
      operation_catalog_id: "catalog-1",
      operation_name: "BCR",
      review_post: "Casa Pavas",
      officer_name: "Oficial Uno",
      id_number: "1-1234-5678",
      officer_phone: "8888-9999",
      weapon_model: "Glock 17",
      weapon_serial: "ABC-123",
      lugar: "San Jose",
      supervisor_id: "supervisor@demo.test",
      status: "CON NOVEDAD",
      type: "Ordinaria",
      observations: "Sin chaleco.",
      gps: { lat: 9.93, lng: -84.08, accuracy: 12 },
      checklist: { uniform: false, equipment: true, punctuality: true, service: true },
      checklist_reasons: { uniform: "Sin chaleco" },
      property_details: { luz: "Buena", perimetro: "OK", sacate: "Cortado", danosPropiedad: "Ninguno" },
      photos: ["data:image/jpeg;base64,PHOTO_BINARY"],
      evidence_bundle: { capturedAt: "2026-07-30T12:00:00.000Z", user: { uid: "auth-1", email: "supervisor@demo.test" }, photos: [{ index: 0, sizeKb: 42, dataUrl: "EVIDENCE_BINARY" }] },
      geo_risk: { riskLevel: "low", flags: [], estimatedSpeedKmh: 4.5 },
    }])

    const csv = String(payload.content)
    expect(csv).toContain("OPERACION_CATALOGO_ID")
    expect(csv).toContain("GPS_LAT")
    expect(csv).toContain("CHECKLIST_JSON")
    expect(csv).toContain("FOTOS_METADATA_JSON")
    expect(csv).toContain("REGISTRO_ANALITICO_JSON")
    expect(csv).toContain("catalog-1")
    expect(csv).toContain("1-1234-5678")
    expect(csv).not.toContain("PHOTO_BINARY")
    expect(csv).not.toContain("EVIDENCE_BINARY")
  })
})