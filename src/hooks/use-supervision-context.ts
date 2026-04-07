"use client"

import { useCallback, useEffect, useRef, useState } from "react"
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

const CACHE_KEY = "ho_supervision_context_cache_v1"

type SupervisionCache = {
  operationCatalog: OperationCatalogRow[]
  weaponsCatalog: WeaponCatalogRow[]
}

function readCache(): SupervisionCache | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SupervisionCache>
    if (!Array.isArray(parsed.operationCatalog)) return null
    return {
      operationCatalog: parsed.operationCatalog,
      weaponsCatalog: Array.isArray(parsed.weaponsCatalog) ? parsed.weaponsCatalog : [],
    }
  } catch { return null }
}

function writeCache(catalog: OperationCatalogRow[], weapons: WeaponCatalogRow[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ operationCatalog: catalog, weaponsCatalog: weapons }))
  } catch { /* ignore */ }
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
  const hasCachedRef = useRef(false)

  // Hydrate catalogs from cache on mount
  useEffect(() => {
    const cached = readCache()
    if (cached) {
      setData((prev) => ({ ...prev, operationCatalog: cached.operationCatalog, weaponsCatalog: cached.weaponsCatalog }))
      hasCachedRef.current = true
    }
  }, [])

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
      setData(EMPTY_STATE)
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading && !hasCachedRef.current) setIsLoading(true)
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
        if (!hasCachedRef.current) setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar supervisión.")))
        return
      }

      const freshCatalog = Array.isArray(body.operationCatalog) ? body.operationCatalog : []
      const freshWeapons = Array.isArray(body.weaponsCatalog) ? body.weaponsCatalog : []

      setData({
        reports: Array.isArray(body.reports) ? body.reports : [],
        operationCatalog: freshCatalog,
        weaponsCatalog: freshWeapons,
      })
      hasCachedRef.current = true
      writeCache(freshCatalog, freshWeapons)
    } catch {
      // Network error — keep cached data if available
      if (!hasCachedRef.current) {
        setData(EMPTY_STATE)
        setError(new Error("No se pudo cargar supervisión."))
      }
    } finally {
      setIsLoading(false)
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