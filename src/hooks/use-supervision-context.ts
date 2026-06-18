"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import type { OfflineMutation } from "@/lib/offline-mutations"
import { useSupabase, useUser } from "@/supabase"
import { useSharedRefreshLoop } from "./use-shared-poll"
import { getSupervisionReportId, mergeSupervisionReports, normalizeSupervisionRow } from "./supervision-context-helpers"
import { useQueuedOfflineTableRows } from "./use-queued-offline-table-rows"

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
const SUPERVISION_REPORTS_LIMIT = 300

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
  const [optimisticReports, setOptimisticReports] = useState<Record<string, unknown>[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [reportsLoading, setReportsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const hasCachedRef = useRef(false)

  const mapQueuedReports = useCallback(
    (items: Array<OfflineMutation & { payload: Record<string, unknown> | Record<string, unknown>[] | undefined }>) => items
      .filter((item) => item.action === "insert" && !!item.payload && !Array.isArray(item.payload))
      .map((item) => ({
        ...normalizeSupervisionRow(item.payload as Record<string, unknown>),
        isPendingSync: true,
        pendingSyncAttempts: item.attempts,
        pendingSyncError: item.lastError ?? null,
      })),
    []
  )

  const queuedReports = useQueuedOfflineTableRows<Record<string, unknown>, Record<string, unknown>>({
    table: "supervisions",
    refreshIntervalMs: 10000,
    mapRows: mapQueuedReports,
  })

  const reports = useMemo(
    () => mergeSupervisionReports(data.reports, optimisticReports, queuedReports),
    [data.reports, optimisticReports, queuedReports]
  )

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
      setOptimisticReports([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading && !hasCachedRef.current) setIsLoading(true)
    if (withLoading) setReportsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/supervision/context?includeReports=0&includeOperationCatalog=1&includeWeaponsCatalog=1",
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

      setData((prev) => ({
        ...prev,
        operationCatalog: freshCatalog,
        weaponsCatalog: freshWeapons,
      }))
      hasCachedRef.current = true
      writeCache(freshCatalog, freshWeapons)
      setIsLoading(false)

      const reportsResponse = await fetchInternalApi(
        supabase,
        `/api/supervision/context?includeReports=1&includeOperationCatalog=0&includeWeaponsCatalog=0&reportsLimit=${SUPERVISION_REPORTS_LIMIT}`,
        { method: "GET", cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const reportsBody = (await reportsResponse.json().catch(() => ({}))) as SupervisionContextResponse
      if (!reportsResponse.ok) {
        setError(new Error(String(reportsBody.error ?? "No se pudieron cargar las supervisiones.")))
        return
      }

      const freshReports = Array.isArray(reportsBody.reports) ? reportsBody.reports : []

      setData((prev) => ({
        ...prev,
        reports: freshReports,
      }))
      setOptimisticReports((prev) => {
        const freshIds = new Set(freshReports.map((row) => getSupervisionReportId(row)).filter(Boolean))
        return prev.filter((row) => {
          const id = getSupervisionReportId(row)
          return !id || !freshIds.has(id)
        })
      })
    } catch {
      // Network error — keep cached data if available
      if (!hasCachedRef.current) {
        setData(EMPTY_STATE)
        setError(new Error("No se pudo cargar supervisión."))
      }
    } finally {
      setReportsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setData(EMPTY_STATE)
      setOptimisticReports([])
      setError(null)
      setIsLoading(false)
    }
  }, [reload, user])

  useSharedRefreshLoop({ enabled: Boolean(user), intervalMs: 180000, reload })

  const addOptimisticReport = useCallback((report: Record<string, unknown>) => {
    const normalized = normalizeSupervisionRow(report)
    const id = getSupervisionReportId(normalized)
    if (!id) return

    setOptimisticReports((prev) => mergeSupervisionReports([], [normalized], prev))
  }, [])

  return {
    reports,
    operationCatalog: data.operationCatalog,
    weaponsCatalog: data.weaponsCatalog,
    isLoading,
    reportsLoading,
    error,
    reload,
    addOptimisticReport,
  }
}
