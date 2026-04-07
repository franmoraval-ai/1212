"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type OperationCatalogRecord = {
  id: string
  operationName?: string
  clientName?: string
  isActive?: boolean
}

type OperationCatalogResponse = {
  operations?: OperationCatalogRecord[]
  error?: string
}

const CACHE_KEY = "ho_operation_catalog_cache_v1"

function readCache(): OperationCatalogRecord[] | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as OperationCatalogRecord[]
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null
  } catch { return null }
}

function writeCache(ops: OperationCatalogRecord[]) {
  if (typeof window === "undefined") return
  try { window.localStorage.setItem(CACHE_KEY, JSON.stringify(ops)) } catch { /* ignore */ }
}

export function useOperationCatalogData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [operations, setOperations] = useState<OperationCatalogRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const hasCachedRef = useRef(false)

  // Hydrate from cache on mount
  useEffect(() => {
    const cached = readCache()
    if (cached) {
      setOperations(cached)
      hasCachedRef.current = true
    }
  }, [])

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
      setOperations([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading && !hasCachedRef.current) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/operation-catalog",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as OperationCatalogResponse

      if (!response.ok) {
        if (!hasCachedRef.current) setOperations([])
        setError(new Error(String(body.error ?? "No se pudo cargar el catálogo operativo.")))
        return
      }

      const fresh = Array.isArray(body.operations) ? body.operations : []
      setOperations(fresh)
      hasCachedRef.current = true
      writeCache(fresh)
    } catch {
      // Network error — keep cached data if available
      if (!hasCachedRef.current) {
        setOperations([])
        setError(new Error("No se pudo cargar el catálogo operativo."))
      }
    } finally {
      setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setOperations([])
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

  return { operations, isLoading, error, reload }
}