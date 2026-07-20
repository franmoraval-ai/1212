import "server-only"
import webpush from "web-push"
import type { SupabaseClient } from "@supabase/supabase-js"

// Envío de Web Push server-side (VAPID). Todo es INERTE si faltan las llaves:
// sin NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY, las funciones no hacen
// nada y devuelven contadores en cero, igual que Sentry sin DSN.

let didConfigure = false
let configuredOk = false

function ensureConfigured(): boolean {
  if (didConfigure) return configuredOk
  didConfigure = true

  const publicKey = String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim()
  const privateKey = String(process.env.VAPID_PRIVATE_KEY ?? "").trim()
  if (!publicKey || !privateKey) {
    configuredOk = false
    return false
  }

  const subject = String(process.env.VAPID_SUBJECT ?? "").trim() || "mailto:soporte@hoseguridad.com"
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
    configuredOk = true
  } catch {
    configuredOk = false
  }
  return configuredOk
}

export function isPushConfigured(): boolean {
  return ensureConfigured()
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

type PushSubscriptionRow = {
  id: string
  endpoint: string | null
  p256dh: string | null
  auth: string | null
}

export type PushDeliveryResult = {
  sent: number
  removed: number
  targeted: number
}

/**
 * Envía un push a todas las suscripciones activas de los usuarios indicados.
 * Desactiva automáticamente las suscripciones caducadas (404/410) para que la
 * tabla no acumule endpoints muertos. No lanza: siempre devuelve contadores.
 */
export async function sendPushToUserIds(
  admin: SupabaseClient,
  userIds: string[],
  payload: PushPayload
): Promise<PushDeliveryResult> {
  if (!ensureConfigured()) return { sent: 0, removed: 0, targeted: 0 }

  const ids = Array.from(
    new Set(userIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  )
  if (ids.length === 0) return { sent: 0, removed: 0, targeted: 0 }

  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", ids)
    .eq("active", true)

  const rows = (data ?? []) as PushSubscriptionRow[]
  if (error || rows.length === 0) {
    return { sent: 0, removed: 0, targeted: rows.length }
  }

  const body = JSON.stringify(payload)
  const staleIds: string[] = []
  let sent = 0

  await Promise.all(
    rows.map(async (row) => {
      if (!row.endpoint || !row.p256dh || !row.auth) return
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body
        )
        sent += 1
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode
        if (statusCode === 404 || statusCode === 410) {
          staleIds.push(row.id)
        }
      }
    })
  )

  let removed = 0
  if (staleIds.length > 0) {
    const { error: updateError } = await admin
      .from("push_subscriptions")
      .update({ active: false, updated_at: new Date().toISOString() })
      .in("id", staleIds)
    if (!updateError) removed = staleIds.length
  }

  return { sent, removed, targeted: rows.length }
}
