import { describe, expect, it } from "vitest"
import { buildStationKey, resolveStationReference, stationMatchesAssigned } from "@/lib/stations"

describe("stations", () => {
  it("builds canonical keys with operation and post", () => {
    expect(buildStationKey("BCR", "Casa Pavas")).toBe("bcr__casa-pavas")
    expect(buildStationKey("Operación Águila", "Puesto Norte 1")).toBe("operacion-aguila__puesto-norte-1")
  })

  it("preserves assigned operation context when resolving a visible post label", () => {
    const station = resolveStationReference({
      assigned: "BCR | Casa Pavas",
      stationLabel: "Casa Pavas",
    })

    expect(station.key).toBe("bcr__casa-pavas")
    expect(station.operationName).toBe("BCR")
    expect(station.postName).toBe("Casa Pavas")
    expect(station.label).toBe("Casa Pavas")
  })

  it("uses the consulted label as post name when no assigned scope exists", () => {
    const station = resolveStationReference({ stationLabel: "Casa Pavas" })

    expect(station.key).toBe("casa-pavas")
    expect(station.postName).toBe("Casa Pavas")
    expect(station.label).toBe("Casa Pavas")
  })

  it("matches assigned scope by canonical key, exact post and composite free text", () => {
    const assigned = "BCR | Casa Pavas"

    expect(stationMatchesAssigned("bcr__casa-pavas", assigned)).toBe(true)
    expect(stationMatchesAssigned("Casa Pavas", assigned)).toBe(true)
    expect(stationMatchesAssigned("Puesto Casa Pavas BCR", assigned)).toBe(true)
    expect(stationMatchesAssigned("Casa Matriz", assigned)).toBe(false)
  })
})