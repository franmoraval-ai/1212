const GRAPH_API_VERSION = "v22.0"

function getConfig() {
  const token = String(process.env.WHATSAPP_CLOUD_API_TOKEN ?? "").trim()
  const phoneNumberId = String(process.env.WHATSAPP_CLOUD_API_PHONE_NUMBER_ID ?? "").trim()
  const templateName = String(process.env.WHATSAPP_CLOUD_API_TEMPLATE_NAME ?? "alerta_operativa").trim()
  const templateLang = String(process.env.WHATSAPP_CLOUD_API_TEMPLATE_LANG ?? "es").trim()
  return { token, phoneNumberId, templateName, templateLang }
}

export function isWhatsappCloudApiConfigured() {
  const { token, phoneNumberId } = getConfig()
  return Boolean(token && phoneNumberId)
}

type SendResult = { ok: true } | { ok: false; error: string }

// Sends a proactive alert via the official WhatsApp Business Cloud API using the approved
// "alerta_operativa" template (required outside the 24h customer-service window: free text is not allowed).
export async function sendWhatsappTemplateAlert(toPhone: string, message: string): Promise<SendResult> {
  const { token, phoneNumberId, templateName, templateLang } = getConfig()
  if (!token || !phoneNumberId) {
    return { ok: false, error: "WhatsApp Cloud API no está configurado (falta token o phone number id)." }
  }

  const digitsOnly = String(toPhone ?? "").replace(/[^0-9]/g, "")
  if (!digitsOnly) {
    return { ok: false, error: "Número de destino inválido." }
  }

  try {
    const response = await fetch(`https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: digitsOnly,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", parameter_name: "mensaje", text: message.slice(0, 1000) }],
            },
          ],
        },
      }),
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}))
      const errorMessage = String(errorBody?.error?.message ?? `HTTP ${response.status}`)
      return { ok: false, error: errorMessage }
    }

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Error desconocido enviando WhatsApp." }
  }
}
