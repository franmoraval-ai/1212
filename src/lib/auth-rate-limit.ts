type RateLimitBucket = {
  count: number
  resetAt: number
}

type RateLimitStore = Map<string, RateLimitBucket>

type RateLimitParams = {
  key: string
  limit: number
  windowMs: number
}

type RateLimitResult = {
  ok: boolean
  retryAfterSec: number
}

type AuthRateLimitDefaults = {
  limit: number
  windowMs: number
  enabled?: boolean
}

type AuthRateLimitConfig = {
  limit: number
  windowMs: number
  enabled: boolean
}

const CLEANUP_MIN_STORE_SIZE = 250
const CLEANUP_INTERVAL_MS = 30_000
let lastCleanupAt = 0

declare global {
  var __hoAuthRateLimitStore: RateLimitStore | undefined
}

function getStore(): RateLimitStore {
  if (!globalThis.__hoAuthRateLimitStore) {
    globalThis.__hoAuthRateLimitStore = new Map<string, RateLimitBucket>()
  }
  return globalThis.__hoAuthRateLimitStore
}

function cleanupExpiredEntries(store: RateLimitStore, now: number) {
  if (store.size < CLEANUP_MIN_STORE_SIZE && now - lastCleanupAt < CLEANUP_INTERVAL_MS) return

  for (const [key, value] of store.entries()) {
    if (value.resetAt <= now) {
      store.delete(key)
    }
  }

  lastCleanupAt = now
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return fallback
  if (["1", "true", "yes", "on"].includes(normalized)) return true
  if (["0", "false", "no", "off"].includes(normalized)) return false
  return fallback
}

function normalizeScopeForEnv(scope: string) {
  return String(scope ?? "auth")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "AUTH"
}

export function readAuthRateLimitConfig(scope: string, defaults: AuthRateLimitDefaults): AuthRateLimitConfig {
  const normalizedScope = normalizeScopeForEnv(scope)
  const prefix = `AUTH_RATE_LIMIT_${normalizedScope}`

  const defaultEnabled = defaults.enabled ?? true
  const globalEnabled = parseBoolean(process.env.AUTH_RATE_LIMIT_ENABLED, true)
  const scopedEnabled = parseBoolean(process.env[`${prefix}_ENABLED`], defaultEnabled)

  return {
    enabled: globalEnabled && scopedEnabled,
    limit: parsePositiveInt(process.env[`${prefix}_LIMIT`], defaults.limit),
    windowMs: parsePositiveInt(process.env[`${prefix}_WINDOW_MS`], defaults.windowMs),
  }
}

export function getClientIp(request: Request) {
  const xForwardedFor = String(request.headers.get("x-forwarded-for") ?? "").trim()
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0]?.trim() || "unknown"
  }

  const realIp = String(request.headers.get("x-real-ip") ?? "").trim()
  if (realIp) return realIp

  const cfConnectingIp = String(request.headers.get("cf-connecting-ip") ?? "").trim()
  if (cfConnectingIp) return cfConnectingIp

  return "unknown"
}

export function buildAuthRateLimitKey(request: Request, scope: string, identity?: string) {
  const ip = getClientIp(request).toLowerCase()
  const normalizedScope = String(scope ?? "auth").trim().toLowerCase()
  const normalizedIdentity = String(identity ?? "").trim().toLowerCase() || "anon"
  return `${normalizedScope}:${ip}:${normalizedIdentity}`
}

export function consumeAuthRateLimit(params: RateLimitParams): RateLimitResult {
  const now = Date.now()
  const store = getStore()
  cleanupExpiredEntries(store, now)

  const key = String(params.key).trim()
  const limit = Math.max(1, Number(params.limit ?? 1))
  const windowMs = Math.max(1000, Number(params.windowMs ?? 60_000))

  const existing = store.get(key)
  if (!existing || existing.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + windowMs,
    })
    return { ok: true, retryAfterSec: Math.ceil(windowMs / 1000) }
  }

  if (existing.count >= limit) {
    const remainingMs = Math.max(0, existing.resetAt - now)
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil(remainingMs / 1000)),
    }
  }

  existing.count += 1
  store.set(key, existing)
  return {
    ok: true,
    retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  }
}
