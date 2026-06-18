"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { useSharedRefreshLoop } from "./use-shared-poll"

type SupervisionRow = {
  id: string
  createdAt?: { toDate?: () => Date }
  operationName?: string
  officerName?: string
  reviewPost?: string
  supervisorId?: string
  status?: string
  type?: string
  idNumber?: string
  officerPhone?: string
  weaponModel?: string
  weaponSerial?: string
  lugar?: string
}

type UserRow = {
  id: string
  email?: string
  firstName?: string
}

type RoundReportRow = {
  id: string
  createdAt?: { toDate?: () => Date }
  startedAt?: { toDate?: () => Date }
  endedAt?: { toDate?: () => Date }
  roundId?: string
  roundName?: string
  postName?: string
  officerId?: string
  officerName?: string
  status?: string
  checkpointsTotal?: number
  checkpointsCompleted?: number
  notes?: string
}

type ResponseBody = {
  supervisions?: Record<string, unknown>[]
  users?: Record<string, unknown>[]
  roundReports?: Record<string, unknown>[]
  error?: string
}

const SUPERVISION_GROUPED_SUPERVISIONS_LIMIT = 400
const SUPERVISION_GROUPED_USERS_LIMIT = 500
const SUPERVISION_GROUPED_ROUND_REPORTS_LIMIT = 400

const EMPTY_STATE = {
  supervisions: [] as SupervisionRow[],
  users: [] as UserRow[],
  roundReports: [] as RoundReportRow[],
}

function mapTimestampAwareRow<T>(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  const timestampKeys = ["created_at", "updated_at", "entry_time", "exit_time", "last_check", "time", "timestamp", "synced_at", "started_at", "ended_at"]
  for (const [key, value] of Object.entries(row)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
    if (timestampKeys.includes(key) && value) {
      out[camelKey] = { toDate: () => new Date(value as string) }
    } else {
      out[camelKey] = value
    }
  }
  out.id = row.id
  return out as T
}

export function useSupervisionGroupedData() {
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
        `/api/supervision-grouped/context?supervisionsLimit=${SUPERVISION_GROUPED_SUPERVISIONS_LIMIT}&usersLimit=${SUPERVISION_GROUPED_USERS_LIMIT}&roundReportsLimit=${SUPERVISION_GROUPED_ROUND_REPORTS_LIMIT}`,
        { method: "GET", cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as ResponseBody

      if (!response.ok) {
        setData(EMPTY_STATE)
        setError(new Error(String(body.error ?? "No se pudo cargar supervisión agrupada.")))
        return
      }

      setData({
        supervisions: Array.isArray(body.supervisions) ? body.supervisions.map((row) => mapTimestampAwareRow<SupervisionRow>(row)) : [],
        users: Array.isArray(body.users) ? body.users.map((row) => mapTimestampAwareRow<UserRow>(row)) : [],
        roundReports: Array.isArray(body.roundReports) ? body.roundReports.map((row) => mapTimestampAwareRow<RoundReportRow>(row)) : [],
      })
    } catch (nextError) {
      setData(EMPTY_STATE)
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar supervisión agrupada."))
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
    supervisions: data.supervisions,
    users: data.users,
    roundReports: data.roundReports,
    isLoading,
    error,
    reload,
  }
}