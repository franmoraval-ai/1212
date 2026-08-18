import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthenticatedActor } from "@/lib/server-auth"

type AuditMetadata = Record<string, unknown>

export type AuditEvent = {
  action: string
  resourceType: string
  resourceId?: string | null
  metadata?: AuditMetadata
}

const SENSITIVE_KEY_PATTERN = /(password|token|secret|pin|nfc|cookie|authorization|credential|hash)/i
const MAX_AUDIT_TEXT_LENGTH = 160
const MAX_AUDIT_DEPTH = 4
const MAX_AUDIT_ARRAY_LENGTH = 50

function normalizeAuditText(value: unknown) {
  return String(value ?? "").trim().slice(0, MAX_AUDIT_TEXT_LENGTH)
}

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }

  if (value instanceof Date) return value.toISOString()
  if (depth >= MAX_AUDIT_DEPTH) return "[truncated]"

  if (Array.isArray(value)) {
    return value.slice(0, MAX_AUDIT_ARRAY_LENGTH).map((item) => sanitizeAuditValue(item, depth + 1))
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_KEY_PATTERN.test(key))
        .map(([key, nestedValue]) => [key, sanitizeAuditValue(nestedValue, depth + 1)])
    )
  }

  return String(value)
}

export function sanitizeAuditMetadata(metadata: AuditMetadata | undefined) {
  return sanitizeAuditValue(metadata ?? {}) as AuditMetadata
}

function getRequestId(request?: Request) {
  const fromHeader = normalizeAuditText(request?.headers.get("x-request-id"))
  if (fromHeader) return fromHeader
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function getRequestPath(request?: Request) {
  if (!request) return null
  try {
    return new URL(request.url).pathname
  } catch {
    return null
  }
}

export async function writeAuditEvent(
  admin: SupabaseClient,
  actor: AuthenticatedActor,
  event: AuditEvent,
  request?: Request
) {
  const action = normalizeAuditText(event.action)
  const resourceType = normalizeAuditText(event.resourceType)
  if (!action || !resourceType) return false

  try {
    const { error } = await admin
      .from("audit_events")
      .insert({
        actor_user_id: normalizeAuditText(actor.userId || actor.uid),
        actor_email: normalizeAuditText(actor.email).toLowerCase(),
        actor_role_level: Number(actor.roleLevel ?? 0),
        action,
        resource_type: resourceType,
        resource_id: normalizeAuditText(event.resourceId) || null,
        metadata: sanitizeAuditMetadata(event.metadata),
        request_id: getRequestId(request),
        source_path: getRequestPath(request),
      })

    if (!error) return true
    console.warn("audit.write_failed", { action, resourceType, message: String(error.message ?? "unknown") })
  } catch (error) {
    console.warn("audit.write_failed", { action, resourceType, message: error instanceof Error ? error.message : "unknown" })
  }

  return false
}