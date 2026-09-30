type NotificationPriority = "low" | "normal" | "high" | "critical"

export type OperationalNotificationMetadata = {
  supervisorName?: string | null
  recipientName?: string | null
  site?: string | null
  category?: string | null
  priority?: string | null
}

type OperationalNotification = OperationalNotificationMetadata & {
  whatsappMessageId: string
  messageText: string
  recipientPhone: string
  sentAt: string
}

function normalizePriority(value: string | null | undefined): NotificationPriority {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (["critical", "critica", "crítica", "urgente"].includes(normalized)) return "critical"
  if (["high", "alta", "alto"].includes(normalized)) return "high"
  if (["low", "baja", "bajo"].includes(normalized)) return "low"
  return "normal"
}

export async function recordOperationalNotification(
  notification: OperationalNotification
): Promise<{ ok: true } | { ok: false; error: string }> {
  const baseUrl = String(process.env.HO_DATA_API_URL ?? "").trim().replace(/\/+$/, "")
  const apiKey = String(process.env.HO_DATA_API_KEY ?? "").trim()
  if (!baseUrl || !apiKey) {
    return { ok: false, error: "HO Data no está configurado." }
  }

  try {
    const response = await fetch(`${baseUrl}/api/operational-notifications`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        whatsapp_message_id: notification.whatsappMessageId,
        message_text: notification.messageText,
        supervisor_name: notification.supervisorName || null,
        recipient_name: notification.recipientName || null,
        recipient_phone: notification.recipientPhone,
        site: notification.site || null,
        category: notification.category || null,
        priority: normalizePriority(notification.priority),
        sent_at: notification.sentAt,
      }),
      signal: AbortSignal.timeout(5000),
    })

    if (!response.ok) {
      return { ok: false, error: `HO Data respondió HTTP ${response.status}.` }
    }

    return { ok: true }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "No se pudo registrar el aviso en HO Data.",
    }
  }
}