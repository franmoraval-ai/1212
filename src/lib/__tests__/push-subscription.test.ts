import { describe, expect, it } from "vitest"
import { normalizePushSubscription } from "../push-subscription"

describe("normalizePushSubscription", () => {
  const valid = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
    keys: { p256dh: "BEXAMPLEp256dhkey", auth: "authsecret" },
    expirationTime: null,
  }

  it("returns normalized fields for a valid browser subscription", () => {
    expect(normalizePushSubscription(valid)).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      p256dh: "BEXAMPLEp256dhkey",
      auth: "authsecret",
    })
  })

  it("trims surrounding whitespace on all fields", () => {
    const result = normalizePushSubscription({
      endpoint: "  https://updates.push.services.mozilla.com/wpush/v2/xyz  ",
      keys: { p256dh: "  key  ", auth: "  secret  " },
    })
    expect(result).toEqual({
      endpoint: "https://updates.push.services.mozilla.com/wpush/v2/xyz",
      p256dh: "key",
      auth: "secret",
    })
  })

  it("rejects a missing or non-http endpoint", () => {
    expect(normalizePushSubscription({ ...valid, endpoint: "" })).toBeNull()
    expect(normalizePushSubscription({ ...valid, endpoint: "ftp://bad" })).toBeNull()
  })

  it("rejects when either crypto key is missing", () => {
    expect(normalizePushSubscription({ endpoint: valid.endpoint, keys: { p256dh: "k" } })).toBeNull()
    expect(normalizePushSubscription({ endpoint: valid.endpoint, keys: { auth: "a" } })).toBeNull()
    expect(normalizePushSubscription({ endpoint: valid.endpoint })).toBeNull()
  })

  it("rejects non-object input", () => {
    expect(normalizePushSubscription(null)).toBeNull()
    expect(normalizePushSubscription("string")).toBeNull()
    expect(normalizePushSubscription(undefined)).toBeNull()
  })
})
