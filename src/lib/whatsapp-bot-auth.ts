// Shared-secret auth for the external WhatsApp bot service, mirrors the CRON_SECRET pattern.
export function hasValidWhatsappBotSecret(request: Request) {
  const configuredSecret = String(process.env.WHATSAPP_BOT_SECRET ?? "").trim()
  if (!configuredSecret) return false

  const authorization = request.headers.get("authorization") ?? ""
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""
  return bearerToken === configuredSecret
}
