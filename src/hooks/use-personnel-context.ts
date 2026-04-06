"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type PersonnelContextOperationCatalogRow = {
  id: string
  operationName?: string
  clientName?: string
  isActive?: boolean
}

export type PersonnelContextSupervisionSeedRow = {
  createdAt?: string | null
  officerName?: string
  idNumber?: string
  officerPhone?: string
  operationName?: string
  reviewPost?: string
}

export type PersonnelContextUserRow = {
  id: string
  firstName?: string
  email?: string
  roleLevel?: number
  status?: string
  assigned?: string
  isOnline?: boolean
  lastSeen?: string | null
}

type PersonnelContextResponse = {
  operationsCatalog?: PersonnelContextOperationCatalogRow[]
  supervisionSeeds?: PersonnelContextSupervisionSeedRow[]
  personnel?: PersonnelContextUserRow[]
  error?: string
}

const EMPTY_STATE = {
  operationsCatalog: [] as PersonnelContextOperationCatalogRow[],
  supervisionSeeds: [] as PersonnelContextSupervisionSeedRow[],
  personnel: [] as PersonnelContextUserRow[],
}

export function usePersonnelContext() {
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
        "/api/personnel/context",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as PersonnelContextResponse

      if (!response.ok) {
        setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar personal.")))
        return
      }

      setData({
        operationsCatalog: Array.isArray(body.operationsCatalog) ? body.operationsCatalog : [],
        supervisionSeeds: Array.isArray(body.supervisionSeeds) ? body.supervisionSeeds : [],
        personnel: Array.isArray(body.personnel) ? body.personnel : [],
      })
    } catch (nextError) {
      setData(EMPTY_STATE)
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar personal."))
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
    operationsCatalog: data.operationsCatalog,
    supervisionSeeds: data.supervisionSeeds,
    personnel: data.personnel,
    isLoading,
    error,
    reload,
  }
}