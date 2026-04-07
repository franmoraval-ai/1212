"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

type UseRoundsContextOptions = {
  includeReports?: boolean
  includeSecurityConfig?: boolean
  includeSessions?: boolean
}

type RoundsContextResponse = {
  rounds?: Record<string, unknown>[]
  reports?: Record<string, unknown>[]
  securityConfigRows?: Record<string, unknown>[]
  roundSessions?: Record<string, unknown>[]
  authorizedOperations?: { operationName: string; clientName: string }[]
  error?: string
}

const EMPTY_STATE = {
  rounds: [] as Record<string, unknown>[],
  reports: [] as Record<string, unknown>[],
  securityConfigRows: [] as Record<string, unknown>[],
  roundSessions: [] as Record<string, unknown>[],
  authorizedOperations: [] as { operationName: string; clientName: string }[],
}

export function useRoundsContext(options: UseRoundsContextOptions = {}) {
  const { includeReports = false, includeSecurityConfig = false, includeSessions = false } = options
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (includeReports) params.set("includeReports", "1")
    if (includeSecurityConfig) params.set("includeSecurityConfig", "1")
    if (includeSessions) params.set("includeSessions", "1")
    const raw = params.toString()
    return raw ? `?${raw}` : ""
  }, [includeReports, includeSecurityConfig, includeSessions])

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
        `/api/rounds/context${queryString}`,
        { method: "GET", cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as RoundsContextResponse

      if (!response.ok) {
        setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar el contexto de rondas.")))
        return
      }

      setData({
        rounds: Array.isArray(body.rounds) ? body.rounds : [],
        reports: Array.isArray(body.reports) ? body.reports : [],
        securityConfigRows: Array.isArray(body.securityConfigRows) ? body.securityConfigRows : [],
        roundSessions: Array.isArray(body.roundSessions) ? body.roundSessions : [],
        authorizedOperations: Array.isArray(body.authorizedOperations) ? body.authorizedOperations : [],
      })
    } catch (nextError) {
      setData(EMPTY_STATE)
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el contexto de rondas."))
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [queryString, supabase, user])

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
    rounds: data.rounds,
    reports: data.reports,
    securityConfigRows: data.securityConfigRows,
    roundSessions: data.roundSessions,
    authorizedOperations: data.authorizedOperations,
    isLoading,
    error,
    reload,
  }
}