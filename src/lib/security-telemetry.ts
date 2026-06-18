type SecuritySeverity = "info" | "warn" | "error"

type SecurityEventPayload = {
  event: string
  severity?: SecuritySeverity
  message?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

function getRequestPath(request: Request) {
  try {
    const url = new URL(request.url)
    return url.pathname
  } catch {
    return "unknown"
  }
}

function getRequestId(request: Request) {
  const fromHeader = String(request.headers.get("x-request-id") ?? "").trim()
  if (fromHeader) return fromHeader

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function logSecurityEvent(request: Request, payload: SecurityEventPayload) {
  const record = {
    scope: "security",
    event: String(payload.event ?? "unknown"),
    severity: payload.severity ?? "info",
    message: String(payload.message ?? ""),
    path: getRequestPath(request),
    method: request.method,
    requestId: getRequestId(request),
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    metadata: payload.metadata ?? {},
    timestamp: new Date().toISOString(),
  }

  const serialized = JSON.stringify(record)
  if (record.severity === "error") {
    console.error(serialized)
    return
  }

  if (record.severity === "warn") {
    console.warn(serialized)
    return
  }

  console.info(serialized)
}
