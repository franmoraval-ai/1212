import { describe, it, expect } from "vitest"
import {
  normalizeIdNumberInput,
  normalizePhoneInput,
  normalizeWeaponSerialInput,
  isNoWeaponInPostValue,
  toDateSafe,
  getSupervisionReportCode,
  getChecklistScore,
  getExecutiveResult,
  formatSupervisionExportDateTime,
  formatSupervisionYesNo,
  getSupervisionChecklistReasonSummary,
  getSupervisionPropertySummary,
  getSupervisionGpsText,
  getSupervisionGeoRiskSummary,
  getSupervisionEvidenceSummary,
  getSupervisionExecutiveSummary,
  buildSupervisionPhotoFileName,
  getSupervisionDraftStorageKey,
  parseSupervisionGps,
} from "../supervision-helpers"

describe("supervision-helpers", () => {
  describe("normalizeIdNumberInput", () => {
    it("formats 9-digit CR ID", () => {
      expect(normalizeIdNumberInput("112345678")).toBe("1-1234-5678")
    })
    it("strips non-alphanumeric", () => {
      expect(normalizeIdNumberInput("abc!@#123")).toBe("ABC123")
    })
  })

  describe("normalizePhoneInput", () => {
    it("formats 8-digit phone", () => {
      expect(normalizePhoneInput("88889999")).toBe("8888-9999")
    })
    it("handles short input", () => {
      expect(normalizePhoneInput("1234")).toBe("1234")
    })
  })

  describe("normalizeWeaponSerialInput", () => {
    it("uppercases and strips chars", () => {
      expect(normalizeWeaponSerialInput("abc-123!")).toBe("ABC-123")
    })
    it("caps at 30 chars", () => {
      expect(normalizeWeaponSerialInput("A".repeat(50))).toHaveLength(30)
    })
  })

  describe("isNoWeaponInPostValue", () => {
    it("matches exact label case-insensitive", () => {
      expect(isNoWeaponInPostValue("no hay arma en el puesto")).toBe(true)
      expect(isNoWeaponInPostValue("  NO HAY ARMA EN EL PUESTO  ")).toBe(true)
    })
    it("rejects other values", () => {
      expect(isNoWeaponInPostValue("Glock 19")).toBe(false)
    })
  })

  describe("toDateSafe", () => {
    it("handles Date", () => {
      const d = new Date("2026-04-06")
      expect(toDateSafe(d)?.toISOString()).toBe(d.toISOString())
    })
    it("handles ISO string", () => {
      expect(toDateSafe("2026-04-06T00:00:00Z")).toBeInstanceOf(Date)
    })
    it("handles toDate method", () => {
      const d = new Date("2026-04-06")
      expect(toDateSafe({ toDate: () => d })).toEqual(d)
    })
    it("returns null for garbage", () => {
      expect(toDateSafe("not-a-date")).toBeNull()
    })
    it("returns null for null", () => {
      expect(toDateSafe(null)).toBeNull()
    })
  })

  describe("getSupervisionReportCode", () => {
    it("generates BS-YYYYMMDD-XXXXXX code", () => {
      const code = getSupervisionReportCode({
        id: "abc123-xxx",
        createdAt: { toDate: () => new Date(2026, 3, 6) },
      })
      expect(code).toBe("BS-20260406-ABC123")
    })
    it("uses fallback for missing date", () => {
      const code = getSupervisionReportCode({ id: "xyz789" })
      expect(code).toMatch(/^BS-00000000-/)
    })
  })

  describe("getChecklistScore", () => {
    it("counts passing items", () => {
      const report = { checklist: { uniform: true, equipment: true, punctuality: false, service: true } }
      const score = getChecklistScore(report)
      expect(score.passed).toBe(3)
      expect(score.total).toBe(4)
      expect(score.pct).toBe(75)
    })
    it("handles missing checklist", () => {
      const score = getChecklistScore({})
      expect(score.passed).toBe(0)
      expect(score.pct).toBe(0)
    })
  })

  describe("getExecutiveResult", () => {
    it("APROBADA for cumplimiento", () => {
      expect(getExecutiveResult({ status: "Cumplimiento total" })).toBe("APROBADA")
    })
    it("CON HALLAZGOS for novedad", () => {
      expect(getExecutiveResult({ status: "Novedad detectada" })).toBe("CON HALLAZGOS")
    })
    it("EN REVISION for unknown", () => {
      expect(getExecutiveResult({ status: "Pendiente" })).toBe("EN REVISION")
    })
  })

  describe("formatSupervisionYesNo", () => {
    it("true -> SI", () => expect(formatSupervisionYesNo(true)).toBe("SI"))
    it("false -> NO", () => expect(formatSupervisionYesNo(false)).toBe("NO"))
  })

  describe("getSupervisionGpsText", () => {
    it("formats lat/lng", () => {
      expect(getSupervisionGpsText({ gps: { lat: 10.123456, lng: -84.654321 } })).toBe("10.123456, -84.654321")
    })
    it("formats lat/lng from JSON string payload", () => {
      expect(getSupervisionGpsText({ gps: "{\"lat\":\"10.123456\",\"lng\":\"-84.654321\"}" })).toBe("10.123456, -84.654321")
    })
    it("returns — for missing", () => {
      expect(getSupervisionGpsText({})).toBe("—")
    })
  })

  describe("parseSupervisionGps", () => {
    it("parses object gps values", () => {
      expect(parseSupervisionGps({ lat: 10.12, lng: -84.65 })).toEqual({ lat: 10.12, lng: -84.65 })
    })

    it("parses stringified gps values", () => {
      expect(parseSupervisionGps("{\"lat\":\"10.12\",\"lng\":\"-84.65\",\"accuracy\":\"12\"}")).toEqual({ lat: 10.12, lng: -84.65, accuracy: 12 })
    })

    it("returns null for invalid gps values", () => {
      expect(parseSupervisionGps("{\"lat\":\"abc\",\"lng\":\"-84.65\"}")).toBeNull()
    })
  })

  describe("getSupervisionGeoRiskSummary", () => {
    it("extracts risk data", () => {
      const r = getSupervisionGeoRiskSummary({
        geoRisk: { riskLevel: "medium", flags: ["fast_travel"], estimatedSpeedKmh: 120.5 },
      })
      expect(r.riskLevel).toBe("medium")
      expect(r.flagsText).toBe("fast_travel")
      expect(r.speedText).toBe("120.5 km/h")
    })
    it("defaults for missing", () => {
      const r = getSupervisionGeoRiskSummary({})
      expect(r.riskLevel).toBe("sin dato")
    })
  })

  describe("getSupervisionPropertySummary", () => {
    it("formats property details", () => {
      const summary = getSupervisionPropertySummary({
        propertyDetails: { luz: "OK", perimetro: "Bien", sacate: "Cortado", danosPropiedad: "Ninguno" },
      })
      expect(summary).toContain("Luz: OK")
      expect(summary).toContain("Daños: Ninguno")
    })
  })

  describe("getSupervisionChecklistReasonSummary", () => {
    it("joins non-empty reasons", () => {
      const summary = getSupervisionChecklistReasonSummary({
        checklistReasons: { uniform: "Falta gorra", service: "Distraido" },
      })
      expect(summary).toContain("Falta gorra")
      expect(summary).toContain("Distraido")
    })
    it("returns — for empty", () => {
      expect(getSupervisionChecklistReasonSummary({})).toBe("—")
    })
  })

  describe("getSupervisionEvidenceSummary", () => {
    it("counts photos from evidence bundle", () => {
      const r = getSupervisionEvidenceSummary({
        evidenceBundle: { photos: ["a", "b"], capturedAt: "2026-01-01" },
      })
      expect(r.photoCount).toBe(2)
    })
    it("falls back to photos array", () => {
      const r = getSupervisionEvidenceSummary({ photos: ["x"] })
      expect(r.photoCount).toBe(1)
    })
  })

  describe("buildSupervisionPhotoFileName", () => {
    it("generates filename with report code", () => {
      const name = buildSupervisionPhotoFileName({ id: "abc123", createdAt: { toDate: () => new Date(2026, 3, 6) } }, 0)
      expect(name).toMatch(/^supervision-BS-20260406-ABC123-evidencia-01\.jpg$/)
    })
  })

  describe("getSupervisionDraftStorageKey", () => {
    it("returns key for user with email", () => {
      const key = getSupervisionDraftStorageKey({ email: "test@example.com" })
      expect(key).toBe("supervision_form_draft_v2:test@example.com")
    })
    it("returns null for empty user", () => {
      expect(getSupervisionDraftStorageKey(null)).toBeNull()
    })
  })

  describe("getSupervisionExecutiveSummary", () => {
    it("combines all summary fields", () => {
      const summary = getSupervisionExecutiveSummary({
        status: "Cumplimiento total",
        checklist: { uniform: true, equipment: true, punctuality: true, service: true },
        geoRisk: { riskLevel: "low" },
        evidenceBundle: { photos: ["a", "b"] },
      })
      expect(summary).toContain("APROBADA")
      expect(summary).toContain("100%")
      expect(summary).toContain("LOW")
      expect(summary).toContain("Evidencias 2")
    })
  })
})
