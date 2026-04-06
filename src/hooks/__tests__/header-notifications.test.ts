import { describe, it, expect } from "vitest"
import { getRoundFraudMessages } from "../header-notification-helpers"

describe("getRoundFraudMessages", () => {
  it("returns empty array for null/undefined", () => {
    expect(getRoundFraudMessages(null)).toEqual([])
    expect(getRoundFraudMessages(undefined)).toEqual([])
  })

  it("returns empty for non-object", () => {
    expect(getRoundFraudMessages("text")).toEqual([])
    expect(getRoundFraudMessages(42)).toEqual([])
  })

  it("returns empty when no alerts key", () => {
    expect(getRoundFraudMessages({})).toEqual([])
    expect(getRoundFraudMessages({ foo: "bar" })).toEqual([])
  })

  it("returns empty when alerts has no messages", () => {
    expect(getRoundFraudMessages({ alerts: {} })).toEqual([])
    expect(getRoundFraudMessages({ alerts: { messages: null } })).toEqual([])
  })

  it("returns empty when messages is not array", () => {
    expect(getRoundFraudMessages({ alerts: { messages: "oops" } })).toEqual([])
    expect(getRoundFraudMessages({ alerts: { messages: 123 } })).toEqual([])
  })

  it("extracts messages from valid structure", () => {
    const logs = {
      alerts: {
        messages: ["Escaneo fuera de rango", "Tiempo insuficiente"],
      },
    }
    expect(getRoundFraudMessages(logs)).toEqual([
      "Escaneo fuera de rango",
      "Tiempo insuficiente",
    ])
  })

  it("stringifies non-string messages and filters empties", () => {
    const logs = {
      alerts: {
        messages: [42, "", "Alerta real", null, 0],
      },
    }
    const result = getRoundFraudMessages(logs)
    // String(null)→"null", String(0)→"0" are truthy; only "" is filtered
    expect(result).toEqual(["42", "Alerta real", "null", "0"])
  })
})
