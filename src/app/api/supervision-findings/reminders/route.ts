import { NextResponse } from "next/server"
import { isPushConfigured, sendPushToUserIds } from "@/lib/push-server"
import { getAdminClient } from "@/lib/server-auth"

const CLAIM_LIMIT = 50
const DELIVERY_CONCURRENCY = 5
const MAX_ATTEMPTS = 5

type ReminderClaim = {
  delivery_id: string
  claim_token: string
  finding_id: string
  responsible_user_id: string
  reminder_kind: "DUE_SOON" | "OVERDUE"
  attempt_count: number
}

function hasValidCronSecret(request: Request) {
  const configuredSecret = String(process.env.CRON_SECRET ?? "").trim()
  if (!configuredSecret) return false

  const authorization = request.headers.get("authorization") ?? ""
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : ""
  return bearerToken === configuredSecret
}

function getDeliveryError(targeted: number) {
  return targeted > 0 ? "push_delivery_failed" : "no_active_push_subscription"
}

export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ error: "Cron no autorizado." }, { status: 401 })
  }

  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Web Push no esta configurado." }, { status: 503 })
  }

  const { admin, error } = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: error ?? "Admin client no disponible." }, { status: 500 })
  }

  const { data, error: claimError } = await admin.rpc("claim_supervision_finding_reminders", {
    p_limit: CLAIM_LIMIT,
    p_lease_minutes: 10,
    p_max_attempts: MAX_ATTEMPTS,
  })

  if (claimError) {
    return NextResponse.json({ error: "No se pudo reclamar la cola de recordatorios." }, { status: 500 })
  }

  const claims = (data ?? []) as unknown as ReminderClaim[]
  let sent = 0
  let retrying = 0
  let completionErrors = 0

  for (let offset = 0; offset < claims.length; offset += DELIVERY_CONCURRENCY) {
    const batch = claims.slice(offset, offset + DELIVERY_CONCURRENCY)
    const results = await Promise.all(batch.map(async (claim) => {
      let delivered = false
      let deliveryError = "push_delivery_exception"

      try {
        const delivery = await sendPushToUserIds(admin, [claim.responsible_user_id], {
          title: "Nueva notificacion",
          body: "Ingresa a la aplicacion para revisar los detalles.",
          url: "/supervision-findings",
          tag: `supervision-finding-${claim.finding_id}`,
        })
        delivered = delivery.sent > 0
        deliveryError = getDeliveryError(delivery.targeted)
      } catch {
        delivered = false
      }

      try {
        const { data: completionData, error: completionError } = await admin.rpc("complete_supervision_finding_reminder", {
          p_delivery_id: claim.delivery_id,
          p_claim_token: claim.claim_token,
          p_delivered: delivered,
          p_error: delivered ? null : deliveryError,
          p_max_attempts: MAX_ATTEMPTS,
        })

        return { delivered, completionError: Boolean(completionError) || completionData !== true }
      } catch {
        return { delivered, completionError: true }
      }
    }))

    for (const result of results) {
      if (result.completionError) completionErrors += 1
      else if (result.delivered) sent += 1
      else retrying += 1
    }
  }

  return NextResponse.json({
    ok: completionErrors === 0,
    claimed: claims.length,
    sent,
    retrying,
    completionErrors,
  }, { status: completionErrors > 0 ? 500 : 200 })
}
