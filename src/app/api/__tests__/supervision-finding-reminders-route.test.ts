import { beforeEach, describe, expect, it, vi } from "vitest"

const {
  getAdminClientMock,
  isPushConfiguredMock,
  sendPushToUserIdsMock,
} = vi.hoisted(() => ({
  getAdminClientMock: vi.fn(),
  isPushConfiguredMock: vi.fn(() => true),
  sendPushToUserIdsMock: vi.fn(),
}))

vi.mock("@/lib/server-auth", () => ({ getAdminClient: getAdminClientMock }))
vi.mock("@/lib/push-server", () => ({
  isPushConfigured: isPushConfiguredMock,
  sendPushToUserIds: sendPushToUserIdsMock,
}))

import { GET } from "@/app/api/supervision-findings/reminders/route"

function createClaim(index: number) {
  return {
    delivery_id: `delivery-${index}`,
    claim_token: `claim-${index}`,
    finding_id: `finding-${index}`,
    responsible_user_id: `user-${index}`,
    reminder_kind: index % 2 === 0 ? "DUE_SOON" : "OVERDUE",
    attempt_count: 1,
  }
}

function createAdminStub(claims = [createClaim(1)]) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "claim_supervision_finding_reminders") {
      return { data: claims, error: null }
    }
    return { data: true, error: null }
  })
  return { client: { rpc }, rpc }
}

function createRequest(secret = "cron-test") {
  return new Request("http://localhost/api/supervision-findings/reminders", {
    headers: { authorization: `Bearer ${secret}` },
  })
}

describe("/api/supervision-findings/reminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv("CRON_SECRET", "cron-test")
    isPushConfiguredMock.mockReturnValue(true)
    sendPushToUserIdsMock.mockResolvedValue({ sent: 1, removed: 0, targeted: 1 })
  })

  it("rejects requests without the configured cron secret", async () => {
    const response = await GET(createRequest("wrong-secret"))

    expect(response.status).toBe(401)
    expect(getAdminClientMock).not.toHaveBeenCalled()
  })

  it("does not claim deliveries when Web Push is not configured", async () => {
    isPushConfiguredMock.mockReturnValue(false)

    const response = await GET(createRequest())

    expect(response.status).toBe(503)
    expect(getAdminClientMock).not.toHaveBeenCalled()
  })

  it("delivers claimed reminders with neutral lock-screen content", async () => {
    const admin = createAdminStub()
    getAdminClientMock.mockReturnValue({ admin: admin.client, error: null })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true, claimed: 1, sent: 1, retrying: 0, completionErrors: 0 })
    expect(admin.rpc).toHaveBeenCalledWith("claim_supervision_finding_reminders", {
      p_limit: 50,
      p_lease_minutes: 10,
      p_max_attempts: 5,
    })
    expect(sendPushToUserIdsMock).toHaveBeenCalledWith(admin.client, ["user-1"], {
      title: "Nueva notificacion",
      body: "Ingresa a la aplicacion para revisar los detalles.",
      url: "/supervision-findings",
      tag: "supervision-finding-finding-1",
    })
    expect(admin.rpc).toHaveBeenCalledWith("complete_supervision_finding_reminder", {
      p_delivery_id: "delivery-1",
      p_claim_token: "claim-1",
      p_delivered: true,
      p_error: null,
      p_max_attempts: 5,
    })
  })

  it("returns an undelivered claim to the retry policy", async () => {
    const admin = createAdminStub()
    getAdminClientMock.mockReturnValue({ admin: admin.client, error: null })
    sendPushToUserIdsMock.mockResolvedValue({ sent: 0, removed: 0, targeted: 0 })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ claimed: 1, sent: 0, retrying: 1 })
    expect(admin.rpc).toHaveBeenCalledWith("complete_supervision_finding_reminder", expect.objectContaining({
      p_delivered: false,
      p_error: "no_active_push_subscription",
    }))
  })

  it("continues through more than one bounded delivery batch", async () => {
    const claims = Array.from({ length: 7 }, (_, index) => createClaim(index + 1))
    const admin = createAdminStub(claims)
    getAdminClientMock.mockReturnValue({ admin: admin.client, error: null })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ claimed: 7, sent: 7, retrying: 0 })
    expect(sendPushToUserIdsMock).toHaveBeenCalledTimes(7)
  })

  it("reports a rejected completion token as a worker error", async () => {
    const admin = createAdminStub()
    admin.rpc.mockImplementation(async (name: string) => (
      name === "claim_supervision_finding_reminders"
        ? { data: [createClaim(1)], error: null }
        : { data: false, error: null }
    ))
    getAdminClientMock.mockReturnValue({ admin: admin.client, error: null })

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ ok: false, claimed: 1, completionErrors: 1 })
  })

  it("returns thrown push attempts to the retry policy", async () => {
    const admin = createAdminStub()
    getAdminClientMock.mockReturnValue({ admin: admin.client, error: null })
    sendPushToUserIdsMock.mockRejectedValue(new Error("transport unavailable"))

    const response = await GET(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ claimed: 1, sent: 0, retrying: 1 })
    expect(admin.rpc).toHaveBeenCalledWith("complete_supervision_finding_reminder", expect.objectContaining({
      p_delivered: false,
      p_error: "push_delivery_exception",
    }))
  })
})
