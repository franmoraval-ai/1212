"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

type OperationCatalogRow = {
  operationName?: string
  clientName?: string
  isActive?: boolean
}

type WeaponCatalogRow = {
  model?: string
  serial?: string
}

type SupervisionContextResponse = {
  reports?: Record<string, unknown>[]
  operationCatalog?: OperationCatalogRow[]
  weaponsCatalog?: WeaponCatalogRow[]
  error?: string
}

const EMPTY_STATE = {
  reports: [] as Record<string, unknown>[],
  operationCatalog: [] as OperationCatalogRow[],
  weaponsCatalog: [] as WeaponCatalogRow[],
}

export function useSupervisionContext() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
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
        "/api/supervision/context",
        { method: "GET", cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as SupervisionContextResponse

      if (!response.ok) {
        setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar supervisión.")))
        return
      }

      setData({
        reports: Array.isArray(body.reports) ? body.reports : [],
        operationCatalog: Array.isArray(body.operationCatalog) ? body.operationCatalog : [],
        weaponsCatalog: Array.isArray(body.weaponsCatalog) ? body.weaponsCatalog : [],
      })
    } catch (nextError) {
      setData(EMPTY_STATE)
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar supervisión."))
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
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

  return {
    reports: data.reports,
    operationCatalog: data.operationCatalog,
    weaponsCatalog: data.weaponsCatalog,
    isLoading,
    error,
    reload,
  }
}