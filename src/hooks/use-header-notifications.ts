"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { getRoundFraudMessages } from "./header-notification-helpers"
import { useSharedRefreshLoop } from "./use-shared-poll"

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

type HeaderAssignedFinding = {
  id: string
  category: string
  severity: string
  status: string
  dueAt?: string | null
  updatedAt?: string | null
  operationName: string
  reviewPost: string
}

type HeaderNotificationsResponse = {
  alerts?: HeaderAlert[]
  unresolvedInternalNotes?: HeaderInternalNote[]
  unresolvedInternalNotesCount?: number
  overdueInternalNotesCount?: number
  roundReports?: HeaderRoundReport[]
  assignedFindings?: HeaderAssignedFinding[]
  assignedFindingsCount?: number
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
    assignedFindings: HeaderAssignedFinding[]
    assignedFindingsCount: number
  }>({
    alerts: [],
    unresolvedInternalNotes: [],
    unresolvedInternalNotesCount: 0,
    overdueInternalNotesCount: 0,
    roundReports: [],
    assignedFindings: [],
    assignedFindingsCount: 0,
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadNotifications = useCallback(async (withLoading = false) => {
    if (!user) {
      setData({
        alerts: [],
        unresolvedInternalNotes: [],
        unresolvedInternalNotesCount: 0,
        overdueInternalNotesCount: 0,
        roundReports: [],
        assignedFindings: [],
        assignedFindingsCount: 0,
      })
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/header/notifications",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as HeaderNotificationsResponse

      if (!response.ok) {
        setError(new Error(String(body.error ?? "No se pudieron cargar las notificaciones.")))
        setData({
          alerts: [],
          unresolvedInternalNotes: [],
          unresolvedInternalNotesCount: 0,
          overdueInternalNotesCount: 0,
          roundReports: [],
          assignedFindings: [],
          assignedFindingsCount: 0,
        })
        return
      }

      setData({
        alerts: Array.isArray(body.alerts) ? body.alerts : [],
        unresolvedInternalNotes: Array.isArray(body.unresolvedInternalNotes) ? body.unresolvedInternalNotes : [],
        unresolvedInternalNotesCount: Number(body.unresolvedInternalNotesCount ?? 0),
        overdueInternalNotesCount: Number(body.overdueInternalNotesCount ?? 0),
        roundReports: Array.isArray(body.roundReports) ? body.roundReports : [],
        assignedFindings: Array.isArray(body.assignedFindings) ? body.assignedFindings : [],
        assignedFindingsCount: Number(body.assignedFindingsCount ?? 0),
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudieron cargar las notificaciones."))
      setData({
        alerts: [],
        unresolvedInternalNotes: [],
        unresolvedInternalNotesCount: 0,
        overdueInternalNotesCount: 0,
        roundReports: [],
        assignedFindings: [],
        assignedFindingsCount: 0,
      })
    } finally {
      if (withLoading) {
        setIsLoading(false)
      }
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setData({
        alerts: [],
        unresolvedInternalNotes: [],
        unresolvedInternalNotesCount: 0,
        overdueInternalNotesCount: 0,
        roundReports: [],
        assignedFindings: [],
        assignedFindingsCount: 0,
      })
      setError(null)
      setIsLoading(false)
    }
  }, [user])

  useSharedRefreshLoop({ enabled: Boolean(user), intervalMs: 180000, reload: loadNotifications })

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
    assignedFindings: data.assignedFindings,
    assignedFindingsCount: data.assignedFindingsCount,
    isLoading,
    error,
  }
}