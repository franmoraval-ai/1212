"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type WeaponControlWeapon = {
  id: string
  model?: string
  serial?: string
  status?: string
  assignedTo?: string
  ammoCount?: number
}

type WeaponControlContextResponse = {
  suggestedPosts?: string[]
  weapons?: WeaponControlWeapon[]
  error?: string
}

const EMPTY_STATE = {
  suggestedPosts: [] as string[],
  weapons: [] as WeaponControlWeapon[],
}

export function useWeaponControlContext(enabled: boolean) {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadContext = useCallback(async (withLoading = false) => {
    if (!enabled || !user) {
      setData(EMPTY_STATE)
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/weapon-control/context",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as WeaponControlContextResponse

      if (!response.ok) {
        setError(new Error(String(body.error ?? "No se pudo cargar el contexto de control de armas.")))
        setData(EMPTY_STATE)
        return
      }

      setData({
        suggestedPosts: Array.isArray(body.suggestedPosts) ? body.suggestedPosts : [],
        weapons: Array.isArray(body.weapons) ? body.weapons : [],
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el contexto de control de armas."))
      setData(EMPTY_STATE)
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [enabled, supabase, user])

  useEffect(() => {
    if (!enabled || !user) {
      setData(EMPTY_STATE)
      setError(null)
      setIsLoading(false)
      return
    }

    let isActive = true
    let requestInFlight = false

    const runLoad = async (withLoading = false) => {
      if (!isActive || requestInFlight) return
      requestInFlight = true
      await loadContext(withLoading)
      requestInFlight = false
    }

    void runLoad(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void runLoad(false)
    }, 180000)

    return () => {
      isActive = false
      window.clearInterval(timer)
    }
  }, [enabled, loadContext, user])

  return {
    suggestedPosts: data.suggestedPosts,
    weapons: data.weapons,
    isLoading,
    error,
    reload: loadContext,
  }
}