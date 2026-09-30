import { afterEach, describe, expect, it, vi } from "vitest"

import { recordOperationalNotification } from "@/lib/ho-data-operational-notifications"

describe("recordOperationalNotification", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("posts the Meta wamid and operational detail to HO Data", async () => {
    vi.stubEnv("HO_DATA_API_URL", "https://ho-data-api.vercel.app/")
    vi.stubEnv("HO_DATA_API_KEY", "integration-secret")
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ accepted: true }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    ))
    vi.stubGlobal("fetch", fetchMock)

    await expect(recordOperationalNotification({
      whatsappMessageId: "wamid.alert-1",
      messageText: "Incidente en acceso norte",
      supervisorName: "Ana",
      recipientName: "Central",
      recipientPhone: "50680000000",
      site: "Acceso norte",
      category: "Incidente",
      priority: "Crítica",
      sentAt: "2026-09-30T20:14:00.000Z",
    })).resolves.toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ho-data-api.vercel.app/api/operational-notifications",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer integration-secret" }),
      })
    )
    const request = fetchMock.mock.calls[0][1] as RequestInit
    expect(JSON.parse(String(request.body))).toEqual({
      whatsapp_message_id: "wamid.alert-1",
      message_text: "Incidente en acceso norte",
      supervisor_name: "Ana",
      recipient_name: "Central",
      recipient_phone: "50680000000",
      site: "Acceso norte",
      category: "Incidente",
      priority: "critical",
      sent_at: "2026-09-30T20:14:00.000Z",
    })
  })

  it("stays inactive when the server integration is not configured", async () => {
    vi.stubEnv("HO_DATA_API_URL", "")
    vi.stubEnv("HO_DATA_API_KEY", "")
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    await expect(recordOperationalNotification({
      whatsappMessageId: "wamid.alert-1",
      messageText: "Alerta",
      recipientPhone: "50680000000",
      sentAt: "2026-09-30T20:14:00.000Z",
    })).resolves.toEqual({ ok: false, error: "HO Data no está configurado." })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})