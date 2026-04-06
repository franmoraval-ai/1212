"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type WeaponRecord = {
  id: string
  model?: string
  serial?: string
  type?: string
  status?: string
  assignedTo?: string
  ammoCount?: number
  lastCheck?: string | null
}

type WeaponsResponse = {
  weapons?: WeaponRecord[]
  error?: string
}

export function useWeaponsData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [weapons, setWeapons] = useState<WeaponRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
      setWeapons([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/weapons",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as WeaponsResponse

      if (!response.ok) {
        setWeapons([])
        setError(new Error(String(body.error ?? "No se pudo cargar armamento.")))
        return
      }

      setWeapons(Array.isArray(body.weapons) ? body.weapons : [])
    } catch (nextError) {
      setWeapons([])
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar armamento."))
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setWeapons([])
      setError(null)
      setIsLoading(false)
      return
    }

    let isActive = true
    let requestInFlight = false

    const runLoad = async (withLoading = false) => {
      if (!isActive || requestInFlight) return
      requestInFlight = true
      await reload(withLoading)
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
  }, [reload, user])

  return { weapons, isLoading, error, reload }
}