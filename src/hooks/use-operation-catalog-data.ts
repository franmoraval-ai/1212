"use client"

import { useCallback, useEffect, useState } from "react"
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

export function useOperationCatalogData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [operations, setOperations] = useState<OperationCatalogRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
      setOperations([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
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
        setOperations([])
        setError(new Error(String(body.error ?? "No se pudo cargar el catálogo operativo.")))
        return
      }

      setOperations(Array.isArray(body.operations) ? body.operations : [])
    } catch (nextError) {
      setOperations([])
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el catálogo operativo."))
    } finally {
      if (withLoading) setIsLoading(false)
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