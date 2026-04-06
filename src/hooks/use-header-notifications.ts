"use client"

import { useEffect, useMemo, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { getRoundFraudMessages } from "./header-notification-helpers"

type HeaderAlert = {
  id: string
  type?: string
  userEmail?: string
  createdAt?: string | null
}

type HeaderInternalNote = {
  id: string
  postName?: string
  priority?: string
  createdAt?: string | null
  status?: string
  reportedByUserId?: string
  reportedByEmail?: string
}

type HeaderRoundReport = {
  id: string
  roundName?: string
  officerName?: string
  createdAt?: string | null
  checkpointLogs?: unknown
}

type HeaderFraudAlert = {
  id: string
  roundName: string
  officerName: string
  at: string | null
  messages: string[]
}

type HeaderNotificationsResponse = {
  alerts?: HeaderAlert[]
  unresolvedInternalNotes?: HeaderInternalNote[]
  unresolvedInternalNotesCount?: number
  overdueInternalNotesCount?: number
  roundReports?: HeaderRoundReport[]
  warnings?: string[]
  error?: string
}



export function useHeaderNotifications() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState<{
    alerts: HeaderAlert[]
    unresolvedInternalNotes: HeaderInternalNote[]
    unresolvedInternalNotesCount: number
    overdueInternalNotesCount: number
    roundReports: HeaderRoundReport[]
  }>({
    alerts: [],
    unresolvedInternalNotes: [],
    unresolvedInternalNotesCount: 0,
    overdueInternalNotesCount: 0,
    roundReports: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!user) {
      setData({
        alerts: [],
        unresolvedInternalNotes: [],
        unresolvedInternalNotesCount: 0,
        overdueInternalNotesCount: 0,
        roundReports: [],
      })
      setError(null)
      setIsLoading(false)
      return
    }

    let isActive = true
    let requestInFlight = false
    const includeFraud = Number(user.roleLevel ?? 1) >= 2
    const noteScope = Number(user.roleLevel ?? 1) <= 1 ? "own" : "all"

    const loadNotifications = async (withLoading = false) => {
      if (requestInFlight) return
      requestInFlight = true
      if (withLoading) setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        if (includeFraud) params.set("includeFraud", "1")
        params.set("noteScope", noteScope)
        params.set("userId", String(user.uid ?? ""))
        params.set("email", String(user.email ?? ""))

        const response = await fetchInternalApi(
          supabase,
          `/api/header/notifications?${params.toString()}`,
          { method: "GET" },
          { refreshIfMissingToken: false, retryOnUnauthorized: false }
        )
        const body = (await response.json().catch(() => ({}))) as HeaderNotificationsResponse
        if (!isActive) return

        if (!response.ok) {
          setError(new Error(String(body.error ?? "No se pudieron cargar las notificaciones.")))
          setData({
            alerts: [],
            unresolvedInternalNotes: [],
            unresolvedInternalNotesCount: 0,
            overdueInternalNotesCount: 0,
            roundReports: [],
          })
          return
        }

        setData({
          alerts: Array.isArray(body.alerts) ? body.alerts : [],
          unresolvedInternalNotes: Array.isArray(body.unresolvedInternalNotes) ? body.unresolvedInternalNotes : [],
          unresolvedInternalNotesCount: Number(body.unresolvedInternalNotesCount ?? 0),
          overdueInternalNotesCount: Number(body.overdueInternalNotesCount ?? 0),
          roundReports: Array.isArray(body.roundReports) ? body.roundReports : [],
        })
      } catch (nextError) {
        if (!isActive) return
        setError(nextError instanceof Error ? nextError : new Error("No se pudieron cargar las notificaciones."))
        setData({
          alerts: [],
          unresolvedInternalNotes: [],
          unresolvedInternalNotesCount: 0,
          overdueInternalNotesCount: 0,
          roundReports: [],
        })
      } finally {
        requestInFlight = false
        if (withLoading && isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadNotifications(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void loadNotifications(false)
    }, 180000)

    return () => {
      isActive = false
      window.clearInterval(timer)
    }
  }, [supabase, user])

  const recentFraudAlerts = useMemo<HeaderFraudAlert[]>(() => {
    return data.roundReports
      .map((report) => {
        const messages = getRoundFraudMessages(report.checkpointLogs)
        if (messages.length === 0) return null
        return {
          id: String(report.id ?? ""),
          roundName: String(report.roundName ?? "Ronda"),
          officerName: String(report.officerName ?? "Oficial"),
          at: report.createdAt ?? null,
          messages,
        }
      })
      .filter((value): value is HeaderFraudAlert => value !== null)
      .slice(0, 8)
  }, [data.roundReports])

  return {
    alerts: data.alerts,
    unresolvedInternalNotes: data.unresolvedInternalNotes,
    unresolvedInternalNotesCount: data.unresolvedInternalNotesCount,
    overdueInternalNotesCount: data.overdueInternalNotesCount,
    recentFraudAlerts,
    isLoading,
    error,
  }
}