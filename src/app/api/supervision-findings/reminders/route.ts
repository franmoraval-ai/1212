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

type EscalationClaim = {
  delivery_id: string
  claim_token: string
  finding_id: string
  responsible_user_id: string
  recipient_user_id: string
  escalation_level: "L3" | "L4"
  escalation_reason: "L3_MANAGER" | "L4_NO_MANAGER" | "L4_48_HOURS"
  attempt_count: number
}

type DeliveryClaim = {
  deliveryId: string
  claimToken: string
  findingId: string
  recipientUserId: string
  completionRpc: "complete_supervision_finding_reminder" | "complete_supervision_finding_escalation"
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

function isMissingEscalationRpc(error: { code?: string; message?: string } | null) {
  if (!error) return false
  const message = String(error.message ?? "").toLowerCase()
  return error.code === "PGRST202"
    || (message.includes("claim_supervision_finding_escalations")
      && (message.includes("schema cache") || message.includes("not find") || message.includes("does not exist")))
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

  const reminderClaims = (Array.isArray(data) ? data : []) as unknown as ReminderClaim[]
  const { data: escalationData, error: escalationClaimError } = await admin.rpc("claim_supervision_finding_escalations", {
    p_limit: CLAIM_LIMIT,
    p_lease_minutes: 10,
    p_max_attempts: MAX_ATTEMPTS,
    p_l4_after_hours: 48,
  })

  const escalationQueueError = Boolean(escalationClaimError) && !isMissingEscalationRpc(escalationClaimError)
  const escalationClaims = escalationQueueError || isMissingEscalationRpc(escalationClaimError)
    ? []
    : (Array.isArray(escalationData) ? escalationData : []) as unknown as EscalationClaim[]
  const claims: DeliveryClaim[] = [
    ...reminderClaims.map((claim) => ({
      deliveryId: claim.delivery_id,
      claimToken: claim.claim_token,
      findingId: claim.finding_id,
      recipientUserId: claim.responsible_user_id,
      completionRpc: "complete_supervision_finding_reminder" as const,
    })),
    ...escalationClaims.map((claim) => ({
      deliveryId: claim.delivery_id,
      claimToken: claim.claim_token,
      findingId: claim.finding_id,
      recipientUserId: claim.recipient_user_id,
      completionRpc: "complete_supervision_finding_escalation" as const,
    })),
  ]
  let sent = 0
  let retrying = 0
  let completionErrors = escalationQueueError ? 1 : 0

  for (let offset = 0; offset < claims.length; offset += DELIVERY_CONCURRENCY) {
    const batch = claims.slice(offset, offset + DELIVERY_CONCURRENCY)
    const results = await Promise.all(batch.map(async (claim) => {
      let delivered = false
      let deliveryError = "push_delivery_exception"

      try {
        const delivery = await sendPushToUserIds(admin, [claim.recipientUserId], {
          title: "Nueva notificacion",
          body: "Ingresa a la aplicacion para revisar los detalles.",
          url: "/supervision-findings",
          tag: `supervision-finding-${claim.findingId}`,
        })
        delivered = delivery.sent > 0
        deliveryError = getDeliveryError(delivery.targeted)
      } catch {
        delivered = false
      }

      try {
        const { data: completionData, error: completionError } = await admin.rpc(claim.completionRpc, {
          p_delivery_id: claim.deliveryId,
          p_claim_token: claim.claimToken,
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
