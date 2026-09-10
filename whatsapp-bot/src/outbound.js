const BASE_URL = String(process.env.STUDIO_API_BASE_URL ?? "").trim().replace(/\/+$/, "")
const SECRET = String(process.env.WHATSAPP_BOT_SECRET ?? "").trim()

async function claimOutboundMessages() {
  const response = await fetch(`${BASE_URL}/api/integrations/whatsapp/outbound`, {
    method: "GET",
    headers: { Authorization: `Bearer ${SECRET}` },
  })
  if (!response.ok) return []
  const data = await response.json().catch(() => ({}))
  return Array.isArray(data.messages) ? data.messages : []
}

async function ackOutboundMessage(id, status, error) {
  await fetch(`${BASE_URL}/api/integrations/whatsapp/outbound`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ id, status, error }),
  }).catch(() => undefined)
}

// Polls the outbound queue (incidents/hallazgos notifications for supervisors/gerentes) and sends each as a direct WhatsApp DM.
export async function pollOutboundMessages(sock) {
  let messages
  try {
    messages = await claimOutboundMessages()
  } catch (error) {
    console.error("Error reclamando cola de salida:", error)
    return
  }

  for (const item of messages) {
    const phone = String(item.to_phone ?? "").replace(/[^0-9]/g, "")
    if (!phone) {
      await ackOutboundMessage(item.id, "failed", "telefono invalido")
      continue
    }

    const jid = `${phone}@s.whatsapp.net`
    try {
      await sock.sendMessage(jid, { text: String(item.message ?? "") })
      await ackOutboundMessage(item.id, "sent")
    } catch (error) {
      console.error("Error enviando mensaje saliente:", { id: item.id, error })
      await ackOutboundMessage(item.id, "failed", error instanceof Error ? error.message : "error desconocido")
    }
  }
}
