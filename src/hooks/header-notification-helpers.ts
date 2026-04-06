/**
 * Extracts fraud alert messages from round report checkpoint-logs.
 * Pure function — no React or Supabase dependencies.
 */
export function getRoundFraudMessages(logs: unknown): string[] {
  if (!logs || typeof logs !== "object") return []
  const candidate = (logs as { alerts?: unknown }).alerts
  if (!candidate || typeof candidate !== "object") return []
  const messages = (candidate as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages.map((message) => String(message)).filter(Boolean) : []
}
