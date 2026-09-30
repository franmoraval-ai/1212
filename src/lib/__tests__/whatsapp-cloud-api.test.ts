import { afterEach, describe, expect, it, vi } from "vitest"

import { sendWhatsappTemplateAlert } from "@/lib/whatsapp-cloud-api"

describe("sendWhatsappTemplateAlert", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("returns the wamid assigned by Meta", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_API_TOKEN", "meta-token")
    vi.stubEnv("WHATSAPP_CLOUD_API_PHONE_NUMBER_ID", "phone-id")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [{ id: "wamid.message-123" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )))

    await expect(sendWhatsappTemplateAlert("+506 8000-0000", "Alerta operativa"))
      .resolves.toEqual({ ok: true, messageId: "wamid.message-123" })
  })

  it("keeps an accepted send successful when Meta omits the id", async () => {
    vi.stubEnv("WHATSAPP_CLOUD_API_TOKEN", "meta-token")
    vi.stubEnv("WHATSAPP_CLOUD_API_PHONE_NUMBER_ID", "phone-id")
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ messages: [] }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )))

    await expect(sendWhatsappTemplateAlert("50680000000", "Alerta operativa"))
      .resolves.toEqual({ ok: true, messageId: null })
  })
})