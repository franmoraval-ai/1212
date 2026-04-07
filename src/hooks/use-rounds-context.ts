"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

const ROUNDS_CACHE_KEY = "ho_rounds_context_cache_v1"

type RoundsCache = {
  rounds: Record<string, unknown>[]
  authorizedOperations: { operationName: string; clientName: string }[]
}

function readRoundsCache(): RoundsCache | null {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ROUNDS_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<RoundsCache>
    if (!Array.isArray(parsed.rounds) || parsed.rounds.length === 0) return null
    return {
      rounds: parsed.rounds,
      authorizedOperations: Array.isArray(parsed.authorizedOperations) ? parsed.authorizedOperations : [],
    }
  } catch {
    return null
  }
}

function writeRoundsCache(rounds: Record<string, unknown>[], authorizedOperations: { operationName: string; clientName: string }[]) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(ROUNDS_CACHE_KEY, JSON.stringify({ rounds, authorizedOperations }))
  } catch { /* localStorage full — ignore */ }
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
  const [roundsLoading, setRoundsLoading] = useState(true)
  const [reportsLoading, setReportsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const hasCachedRef = useRef(false)

  // Hydrate rounds + authorizedOperations from localStorage on mount
  useEffect(() => {
    const cached = readRoundsCache()
    if (cached) {
      setData((prev) => ({ ...prev, rounds: cached.rounds, authorizedOperations: cached.authorizedOperations }))
      setRoundsLoading(false)
      hasCachedRef.current = true
    }
  }, [])

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
      setRoundsLoading(false)
      setReportsLoading(false)
      return
    }

    if (withLoading) {
      if (!hasCachedRef.current) setRoundsLoading(true)
      if (includeReports) setReportsLoading(true)
    }
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
        if (!hasCachedRef.current) setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar el contexto de rondas.")))
        return
      }

      const freshRounds = Array.isArray(body.rounds) ? body.rounds : []
      const freshOps = Array.isArray(body.authorizedOperations) ? body.authorizedOperations : []

      setData({
        rounds: freshRounds,
        reports: Array.isArray(body.reports) ? body.reports : [],
        securityConfigRows: Array.isArray(body.securityConfigRows) ? body.securityConfigRows : [],
        roundSessions: Array.isArray(body.roundSessions) ? body.roundSessions : [],
        authorizedOperations: freshOps,
      })
      hasCachedRef.current = true
      writeRoundsCache(freshRounds, freshOps)
    } catch (nextError) {
      // On network error, keep cached data if available
      if (!hasCachedRef.current) {
        setData(EMPTY_STATE)
        setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el contexto de rondas."))
      }
    } finally {
      setRoundsLoading(false)
      setReportsLoading(false)
    }
  }, [queryString, supabase, user, includeReports])

  useEffect(() => {
    if (!user) {
      setData(EMPTY_STATE)
      setError(null)
      setRoundsLoading(false)
      setReportsLoading(false)
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
    isLoading: roundsLoading,
    roundsLoading,
    reportsLoading,
    error,
    reload,
  }
}