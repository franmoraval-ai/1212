"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { useSharedRefreshLoop } from "./use-shared-poll"

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
  personnelCode?: string
  firstName?: string
  email?: string
  roleLevel?: number
  status?: string
  assigned?: string
  managerUserId?: string | null
  isOnline?: boolean
  lastSeen?: string | null
}

export type PersonnelContextPreregisteredRow = {
  id: string
  personnelCode: string
  fullName: string
  idNumber: string
  phone: string
  assignments: Array<{
    operationCatalogId: string
    operationName: string
    postName: string
  }>
}

type PersonnelContextResponse = {
  operationsCatalog?: PersonnelContextOperationCatalogRow[]
  supervisionSeeds?: PersonnelContextSupervisionSeedRow[]
  personnel?: PersonnelContextUserRow[]
  preregisteredPersonnel?: PersonnelContextPreregisteredRow[]
  error?: string
}

const EMPTY_STATE = {
  operationsCatalog: [] as PersonnelContextOperationCatalogRow[],
  supervisionSeeds: [] as PersonnelContextSupervisionSeedRow[],
  personnel: [] as PersonnelContextUserRow[],
  preregisteredPersonnel: [] as PersonnelContextPreregisteredRow[],
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
        preregisteredPersonnel: Array.isArray(body.preregisteredPersonnel) ? body.preregisteredPersonnel : [],
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
    }
  }, [reload, user])

  useSharedRefreshLoop({ enabled: Boolean(user), intervalMs: 180000, reload })

  return {
    operationsCatalog: data.operationsCatalog,
    supervisionSeeds: data.supervisionSeeds,
    personnel: data.personnel,
    preregisteredPersonnel: data.preregisteredPersonnel,
    isLoading,
    error,
    reload,
  }
}