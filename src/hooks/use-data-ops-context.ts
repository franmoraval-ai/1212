"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

type ExportJobRecord = {
  id: string
  entityType?: string
  dataSource?: string
  exportFormat?: string
  status?: string
  rowCount?: number
  fileName?: string
  errorMessage?: string
  createdAt?: string | null
  completedAt?: string | null
}

type ArchiveRunRecord = {
  id: string
  entityType?: string
  cutoffDate?: string | null
  dryRun?: boolean
  batchSize?: number
  status?: string
  matchedCount?: number
  archivedCount?: number
  deletedCount?: number
  errorMessage?: string
  createdAt?: string | null
  completedAt?: string | null
}

type RestoreRunRecord = {
  id: string
  sourceRunId?: string
  entityType?: string
  dryRun?: boolean
  batchSize?: number
  status?: string
  matchedCount?: number
  restoredCount?: number
  removedFromArchiveCount?: number
  errorMessage?: string
  createdAt?: string | null
  completedAt?: string | null
}

type DataOpsContextResponse = {
  exportJobs?: ExportJobRecord[]
  archiveRuns?: ArchiveRunRecord[]
  restoreRuns?: RestoreRunRecord[]
  error?: string
}

const EMPTY_STATE = {
  exportJobs: [] as ExportJobRecord[],
  archiveRuns: [] as ArchiveRunRecord[],
  restoreRuns: [] as RestoreRunRecord[],
}

export function useDataOpsContext(enabled: boolean) {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async (withLoading = false) => {
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
        "/api/data-ops/context",
        { method: "GET", cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as DataOpsContextResponse

      if (!response.ok) {
        setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar el centro de datos.")))
        return
      }

      setData({
        exportJobs: Array.isArray(body.exportJobs) ? body.exportJobs : [],
        archiveRuns: Array.isArray(body.archiveRuns) ? body.archiveRuns : [],
        restoreRuns: Array.isArray(body.restoreRuns) ? body.restoreRuns : [],
      })
    } catch (nextError) {
      setData(EMPTY_STATE)
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el centro de datos."))
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
      await reload(withLoading)
      requestInFlight = false
    }

    void runLoad(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void runLoad(false)
    }, 60000)

    return () => {
      isActive = false
      window.clearInterval(timer)
    }
  }, [enabled, reload, user])

  return {
    exportJobs: data.exportJobs,
    archiveRuns: data.archiveRuns,
    restoreRuns: data.restoreRuns,
    isLoading,
    error,
    reload,
  }
}