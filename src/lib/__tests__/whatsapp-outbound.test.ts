import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  isWhatsappCloudApiConfiguredMock,
  recordOperationalNotificationMock,
  sendWhatsappTemplateAlertMock,
} = vi.hoisted(() => ({
  isWhatsappCloudApiConfiguredMock: vi.fn(() => true),
  recordOperationalNotificationMock: vi.fn(),
  sendWhatsappTemplateAlertMock: vi.fn(),
}))

vi.mock("@/lib/whatsapp-cloud-api", () => ({
  isWhatsappCloudApiConfigured: isWhatsappCloudApiConfiguredMock,
  sendWhatsappTemplateAlert: sendWhatsappTemplateAlertMock,
}))
vi.mock("@/lib/ho-data-operational-notifications", () => ({
  recordOperationalNotification: recordOperationalNotificationMock,
}))

import { enqueueWhatsappMessage } from "@/lib/whatsapp-outbound"

describe("enqueueWhatsappMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isWhatsappCloudApiConfiguredMock.mockReturnValue(true)
    sendWhatsappTemplateAlertMock.mockResolvedValue({ ok: true, messageId: "wamid.alert-1" })
    recordOperationalNotificationMock.mockResolvedValue({ ok: true })
  })

  it("records successful Cloud API alerts in HO Data", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const admin = { from: vi.fn(() => ({ insert })) }

    const result = await enqueueWhatsappMessage(admin as never, {
      toPhone: "+506 8000-0000",
      message: "Incidente en acceso norte",
      context: "incident:new",
      metadata: {
        supervisorName: "Ana",
        recipientName: "Central",
        site: "Acceso norte",
        category: "Incidente",
        priority: "Alta",
      },
    })

    expect(result).toEqual({ queued: true })
    expect(recordOperationalNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      whatsappMessageId: "wamid.alert-1",
      messageText: "Incidente en acceso norte",
      recipientPhone: "50680000000",
      supervisorName: "Ana",
      recipientName: "Central",
      site: "Acceso norte",
      category: "Incidente",
      priority: "Alta",
    }))
  })

  it("does not turn a monitoring failure into a WhatsApp failure", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const admin = { from: vi.fn(() => ({ insert })) }
    recordOperationalNotificationMock.mockResolvedValue({ ok: false, error: "HTTP 503" })

    await expect(enqueueWhatsappMessage(admin as never, {
      toPhone: "50680000000",
      message: "Alerta",
    })).resolves.toEqual({ queued: true })
  })
})