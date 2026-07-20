// Normalización pura de una PushSubscription entrante (frontera del API /api/push).
// Sin dependencias de navegador ni servidor para ser 100% testeable.

export type NormalizedPushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

function asTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

/**
 * Valida y normaliza el objeto `subscription.toJSON()` que envía el navegador.
 * Devuelve null si falta el endpoint o alguna de las llaves criptográficas,
 * porque sin ellas no se puede cifrar/entregar el push.
 */
export function normalizePushSubscription(input: unknown): NormalizedPushSubscription | null {
  if (!input || typeof input !== "object") return null

  const record = input as { endpoint?: unknown; keys?: unknown }
  const endpoint = asTrimmedString(record.endpoint)
  if (!endpoint || !/^https?:\/\//i.test(endpoint)) return null

  const keys = (record.keys && typeof record.keys === "object" ? record.keys : {}) as {
    p256dh?: unknown
    auth?: unknown
  }
  const p256dh = asTrimmedString(keys.p256dh)
  const auth = asTrimmedString(keys.auth)
  if (!p256dh || !auth) return null

  return { endpoint, p256dh, auth }
}
