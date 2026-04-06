import { describe, it, expect } from "vitest"
import {
  normalizeRoundQr,
  normalizeScanToken,
  splitCheckpointCodeInput,
  joinCheckpointCodeInput,
  toInputDateLocal,
  haversineDistanceMeters,
  formatDurationLabel,
  getFrequencyMinutes,
  normalizeRoundCheckpoints,
  buildTrackSvgPath,
  loadRoundSecurityConfig,
  getTrackFromUnknownLogs,
  buildGpxXml,
  computeRoundAlerts,
  getReportCreatedDate,
  getReportRoundName,
  getReportProgressLabel,
  getRoundReportCode,
  classifyOfflineSyncCause,
  getRoundLogDetails,
  getRoundLogPhotos,
  getRoundCompletionRateLabel,
  formatRoundBooleanLabel,
  getDateFromUnknown,
} from "../round-helpers"

describe("round-helpers", () => {
  describe("normalizeRoundQr", () => {
    it("parses valid QR JSON", () => {
      const result = normalizeRoundQr(JSON.stringify({ id: "r1", name: "Ronda Norte", post: "P1" }))
      expect(result).toEqual({ id: "r1", name: "Ronda Norte", post: "P1" })
    })

    it("returns null for invalid JSON", () => {
      expect(normalizeRoundQr("not-json")).toBeNull()
    })

    it("returns null when id is missing", () => {
      expect(normalizeRoundQr(JSON.stringify({ name: "test" }))).toBeNull()
    })
  })

  describe("normalizeScanToken", () => {
    it("trims and lowercases", () => {
      expect(normalizeScanToken("  ABC-123  ")).toBe("abc-123")
    })
  })

  describe("splitCheckpointCodeInput / joinCheckpointCodeInput", () => {
    it("splits by newlines, commas, semicolons and dedupes", () => {
      expect(splitCheckpointCodeInput("a\nb,c;d,a")).toEqual(["a", "b", "c", "d"])
    })

    it("joins back with newlines", () => {
      expect(joinCheckpointCodeInput(["x", "y", "x"])).toBe("x\ny")
    })
  })

  describe("toInputDateLocal", () => {
    it("formats date as YYYY-MM-DD", () => {
      expect(toInputDateLocal(new Date(2026, 3, 6))).toBe("2026-04-06")
    })
  })

  describe("haversineDistanceMeters", () => {
    it("returns ~0 for same point", () => {
      const p = { lat: 10, lng: -84 }
      expect(haversineDistanceMeters(p, p)).toBeCloseTo(0, 0)
    })

    it("returns reasonable distance for known points", () => {
      const sj = { lat: 9.9281, lng: -84.0907 }
      const heredia = { lat: 10.0023, lng: -84.1165 }
      const dist = haversineDistanceMeters(sj, heredia)
      expect(dist).toBeGreaterThan(5000)
      expect(dist).toBeLessThan(15000)
    })
  })

  describe("formatDurationLabel", () => {
    it("formats 0 seconds", () => expect(formatDurationLabel(0)).toBe("00:00:00"))
    it("formats 1 hour 30 min", () => expect(formatDurationLabel(5400)).toBe("01:30:00"))
    it("handles negative", () => expect(formatDurationLabel(-10)).toBe("00:00:00"))
  })

  describe("getFrequencyMinutes", () => {
    it("extracts minutes from string", () => {
      expect(getFrequencyMinutes("Cada 30 minutos")).toBe(30)
    })
    it("clamps to minimum 5", () => {
      expect(getFrequencyMinutes("Cada 2 minutos")).toBe(5)
    })
    it("defaults to 30 for undefined", () => {
      expect(getFrequencyMinutes(undefined)).toBe(30)
    })
  })

  describe("normalizeRoundCheckpoints", () => {
    it("handles array input", () => {
      const result = normalizeRoundCheckpoints([{ name: "CP1" }])
      expect(result).toEqual([{ name: "CP1" }])
    })
    it("handles JSON string", () => {
      const result = normalizeRoundCheckpoints(JSON.stringify([{ name: "CP1" }]))
      expect(result).toEqual([{ name: "CP1" }])
    })
    it("handles wrapped object", () => {
      const result = normalizeRoundCheckpoints({ checkpoints: [{ name: "CP1" }] })
      expect(result).toEqual([{ name: "CP1" }])
    })
    it("returns empty for null", () => {
      expect(normalizeRoundCheckpoints(null)).toEqual([])
    })
  })

  describe("getTrackFromUnknownLogs", () => {
    it("extracts gps_track from logs", () => {
      const logs = { gps_track: [{ lat: 10, lng: -84, accuracy: 5, speed: 1, ts: 1000, recordedAt: "2025-01-01" }] }
      const result = getTrackFromUnknownLogs(logs)
      expect(result).toHaveLength(1)
      expect(result[0].lat).toBe(10)
    })
    it("skips invalid points", () => {
      const logs = { gps_track: [{ lat: NaN, lng: -84 }, { lat: 10, lng: -84, accuracy: 5, speed: null, ts: 0, recordedAt: "" }] }
      expect(getTrackFromUnknownLogs(logs)).toHaveLength(1)
    })
    it("returns empty for null", () => {
      expect(getTrackFromUnknownLogs(null)).toEqual([])
    })
  })

  describe("buildTrackSvgPath", () => {
    it("returns empty for < 2 points", () => {
      expect(buildTrackSvgPath([], 100, 100)).toBe("")
    })
    it("returns SVG path for 2+ points", () => {
      const pts = [
        { lat: 10, lng: -84, accuracy: 5, speed: null, recordedAt: "", ts: 0 },
        { lat: 10.001, lng: -83.999, accuracy: 5, speed: null, recordedAt: "", ts: 1 },
      ]
      const path = buildTrackSvgPath(pts, 100, 100)
      expect(path).toContain("M")
      expect(path).toContain("L")
    })
  })

  describe("loadRoundSecurityConfig", () => {
    it("returns defaults when no localStorage", () => {
      const cfg = loadRoundSecurityConfig()
      expect(cfg.geofenceRadiusMeters).toBe(50)
      expect(cfg.noScanGapMinutes).toBe(10)
      expect(cfg.maxJumpMeters).toBe(120)
    })
  })

  describe("computeRoundAlerts", () => {
    it("detects no-scan gaps", () => {
      const cfg = { geofenceRadiusMeters: 50, noScanGapMinutes: 5, maxJumpMeters: 120 }
      const result = computeRoundAlerts(
        [],
        [],
        "2026-01-01T00:00:00Z",
        "2026-01-01T01:00:00Z",
        cfg
      )
      expect(result.noScanGaps).toBeGreaterThan(0)
    })
  })

  describe("getDateFromUnknown", () => {
    it("handles Date", () => {
      const d = new Date("2026-01-01")
      expect(getDateFromUnknown(d)?.toISOString()).toBe(d.toISOString())
    })
    it("handles ISO string", () => {
      expect(getDateFromUnknown("2026-04-06T00:00:00Z")).toBeInstanceOf(Date)
    })
    it("handles toDate method", () => {
      const d = new Date("2026-01-01")
      expect(getDateFromUnknown({ toDate: () => d })?.toISOString()).toBe(d.toISOString())
    })
    it("returns null for garbage", () => {
      expect(getDateFromUnknown("not-a-date")).toBeNull()
    })
  })

  describe("report accessors", () => {
    const report = {
      id: "abc12345-xxxx",
      roundName: "Ronda 1",
      round_name: "Ronda 1 snake",
      checkpointsTotal: 5,
      checkpointsCompleted: 3,
      createdAt: { toDate: () => new Date(2026, 3, 6) },
    }

    it("getReportRoundName prefers camelCase", () => {
      expect(getReportRoundName(report)).toBe("Ronda 1")
    })
    it("getReportProgressLabel", () => {
      expect(getReportProgressLabel(report)).toBe("3/5")
    })
    it("getReportCreatedDate", () => {
      expect(getReportCreatedDate(report)).toBeInstanceOf(Date)
    })
    it("getRoundReportCode", () => {
      const code = getRoundReportCode(report)
      expect(code).toMatch(/^20260406-abc12345$/)
    })
    it("getRoundCompletionRateLabel", () => {
      expect(getRoundCompletionRateLabel(report)).toBe("60%")
    })
  })

  describe("classifyOfflineSyncCause", () => {
    it("classifies network errors", () => {
      expect(classifyOfflineSyncCause("failed to fetch")).toBe("Conectividad / señal")
    })
    it("classifies empty as pending", () => {
      expect(classifyOfflineSyncCause(null)).toBe("Pendiente de sincronizacion")
    })
    it("classifies unknown as review", () => {
      expect(classifyOfflineSyncCause("some unknown error")).toBe("Requiere revision")
    })
  })

  describe("formatRoundBooleanLabel", () => {
    it("true -> SI", () => expect(formatRoundBooleanLabel(true)).toBe("SI"))
    it("false -> NO", () => expect(formatRoundBooleanLabel(false)).toBe("NO"))
    it("null -> -", () => expect(formatRoundBooleanLabel(null)).toBe("-"))
  })

  describe("getRoundLogDetails", () => {
    it("returns defaults for null logs", () => {
      const d = getRoundLogDetails({ id: "x" })
      expect(d.preRoundCondition).toBe("-")
      expect(d.evidenceCount).toBe(0)
    })
    it("extracts data from valid logs", () => {
      const d = getRoundLogDetails({
        id: "x",
        checkpointLogs: {
          pre_round: { condition: "NORMAL", checklist: { doorsClosed: true, lightsOk: false, perimeterOk: true, noStrangers: true } },
          gps_distance_meters: 1500,
          elapsed_seconds: 3600,
          photos: ["a.jpg", "b.jpg"],
          events: [{ at: "2026-01-01", qrValue: "manual", type: "checkpoint_match" }],
          checkpoints: [{ name: "CP1", completedAt: "2026-01-01" }, { name: "CP2" }],
        },
      })
      expect(d.preRoundCondition).toBe("NORMAL")
      expect(d.distanceKm).toBe("1.50")
      expect(d.duration).toBe("01:00:00")
      expect(d.evidenceCount).toBe(2)
      expect(d.manualValidations).toBe(1)
    })
  })

  describe("getRoundLogPhotos", () => {
    it("extracts photos array", () => {
      expect(getRoundLogPhotos({ id: "x", checkpointLogs: { photos: ["a", "b"] } })).toEqual(["a", "b"])
    })
    it("returns empty for missing", () => {
      expect(getRoundLogPhotos({ id: "x" })).toEqual([])
    })
  })

  describe("buildGpxXml", () => {
    it("produces valid GPX structure", () => {
      const xml = buildGpxXml(
        [{ lat: 10, lng: -84, accuracy: 5, speed: null, recordedAt: "2026-01-01T00:00:00Z", ts: 0 }],
        "Test Round"
      )
      expect(xml).toContain('<?xml version="1.0"')
      expect(xml).toContain("<name>Test Round</name>")
      expect(xml).toContain('lat="10"')
    })
  })
})
