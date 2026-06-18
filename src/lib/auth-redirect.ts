const FALLBACK_RECOVERY_REDIRECT = "https://hoseguridad.com/login"

function parseAllowedOriginsFromEnv() {
  const raw = String(process.env.AUTH_RECOVERY_ALLOWED_ORIGINS ?? "").trim()
  if (!raw) return [] as string[]

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin
  } catch {
    return ""
  }
}

function getAllowedRecoveryOrigins() {
  const fromEnv = parseAllowedOriginsFromEnv().map(normalizeOrigin).filter(Boolean)
  const fromSiteUrl = normalizeOrigin(String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim())
  const fallbackOrigin = normalizeOrigin(FALLBACK_RECOVERY_REDIRECT)

  return new Set<string>([...fromEnv, fromSiteUrl, fallbackOrigin].filter(Boolean))
}

function getDefaultRecoveryRedirect() {
  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL ?? "").trim()
  if (siteUrl) {
    try {
      return new URL("/login", siteUrl).toString()
    } catch {
      return FALLBACK_RECOVERY_REDIRECT
    }
  }

  return FALLBACK_RECOVERY_REDIRECT
}

export function sanitizeRecoveryRedirect(rawRedirectTo: unknown) {
  const fallback = getDefaultRecoveryRedirect()
  const candidate = String(rawRedirectTo ?? "").trim()
  if (!candidate) return fallback

  const allowedOrigins = getAllowedRecoveryOrigins()

  try {
    const parsed = candidate.startsWith("/")
      ? new URL(candidate, fallback)
      : new URL(candidate)

    if (!allowedOrigins.has(parsed.origin)) {
      return fallback
    }

    return parsed.toString()
  } catch {
    return fallback
  }
}
