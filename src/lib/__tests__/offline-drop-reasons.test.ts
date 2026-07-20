import { describe, expect, it } from "vitest"
import { classifyOfflineDropReason } from "@/lib/offline-drop-reasons"

describe("classifyOfflineDropReason", () => {
  it("flags permission/auth failures as non-retryable", () => {
    for (const reason of [
      "Permiso denegado para iniciar la sesión.",
      "Forbidden",
      "No autenticado",
      "new row violates row-level security policy",
      "Token inválido",
    ]) {
      const result = classifyOfflineDropReason(reason)
      expect(result.category).toBe("permission")
      expect(result.retryable).toBe(false)
    }
  })

  it("flags storage/quota failures as retryable", () => {
    const result = classifyOfflineDropReason("The quota has been exceeded.")
    expect(result.category).toBe("storage")
    expect(result.retryable).toBe(true)
  })

  it("flags oversized records as non-retryable", () => {
    const result = classifyOfflineDropReason("La boleta es demasiado pesada para guardarse offline en este dispositivo.")
    expect(result.category).toBe("oversize")
    expect(result.retryable).toBe(false)
  })

  it("flags orphaned session operations as non-retryable", () => {
    const result = classifyOfflineDropReason("La sesión offline asociada ya no existe y la operación quedó huérfana.")
    expect(result.category).toBe("orphan")
    expect(result.retryable).toBe(false)
  })

  it("flags connectivity/retry-exhaustion failures as retryable", () => {
    for (const reason of [
      "Exceso de reintentos por conectividad.",
      "Failed to fetch",
      "Request timed out",
    ]) {
      const result = classifyOfflineDropReason(reason)
      expect(result.category).toBe("connectivity")
      expect(result.retryable).toBe(true)
    }
  })

  it("falls back to a retryable unknown category with a safe action", () => {
    const result = classifyOfflineDropReason("")
    expect(result.category).toBe("unknown")
    expect(result.retryable).toBe(true)
    expect(result.action.length).toBeGreaterThan(0)
  })
})
