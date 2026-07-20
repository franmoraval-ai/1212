"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import {
  getExistingPushSubscription,
  getPushPermission,
  isPushConfigured,
  isPushSupported,
  subscribeBrowserToPush,
  unsubscribeBrowserFromPush,
} from "@/lib/push-client"
import { useSupabase } from "@/supabase"

type PushStatus = "unsupported" | "unconfigured" | "denied" | "disabled" | "enabled"

export function usePushNotifications() {
  const { supabase } = useSupabase()
  const [status, setStatus] = useState<PushStatus>("disabled")
  const [busy, setBusy] = useState(false)

  const resolveStatus = useCallback(async () => {
    if (!isPushSupported()) {
      setStatus("unsupported")
      return
    }
    if (!isPushConfigured()) {
      setStatus("unconfigured")
      return
    }
    if (getPushPermission() === "denied") {
      setStatus("denied")
      return
    }
    const existing = await getExistingPushSubscription()
    setStatus(existing ? "enabled" : "disabled")
  }, [])

  useEffect(() => {
    void resolveStatus()
  }, [resolveStatus])

  const enable = useCallback(async () => {
    if (!supabase || busy) return
    setBusy(true)
    try {
      const subscription = await subscribeBrowserToPush()
      if (!subscription) {
        await resolveStatus()
        return
      }
      await fetchInternalApi(supabase, "/api/push/subscribe", {
        method: "POST",
        body: JSON.stringify({
          subscription: subscription.toJSON(),
          userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        }),
      })
      setStatus("enabled")
    } catch {
      await resolveStatus()
    } finally {
      setBusy(false)
    }
  }, [supabase, busy, resolveStatus])

  const disable = useCallback(async () => {
    if (!supabase || busy) return
    setBusy(true)
    try {
      const endpoint = await unsubscribeBrowserFromPush()
      if (endpoint) {
        await fetchInternalApi(supabase, "/api/push/subscribe", {
          method: "DELETE",
          body: JSON.stringify({ endpoint }),
        })
      }
      setStatus("disabled")
    } catch {
      await resolveStatus()
    } finally {
      setBusy(false)
    }
  }, [supabase, busy, resolveStatus])

  return { status, busy, enable, disable }
}
