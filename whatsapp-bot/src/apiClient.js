const BASE_URL = String(process.env.STUDIO_API_BASE_URL ?? "").replace(/\/+$/, "")
const SECRET = process.env.WHATSAPP_BOT_SECRET ?? ""

async function postJson(path, payload) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SECRET}`,
    },
    body: JSON.stringify(payload),
  })

  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, status: response.status, data }
}

export function submitAttendance(payload) {
  return postJson("/api/integrations/whatsapp/attendance", payload)
}

export function submitReport(payload) {
  return postJson("/api/integrations/whatsapp/report", payload)
}
