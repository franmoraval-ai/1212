"use client"

import { useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

type OverviewSupervision = {
  id: string
  createdAt?: string | null
  gps?: unknown
  reviewPost?: string
  officerName?: string
  status?: string
  operationName?: string
}

type OverviewIncident = {
  id: string
  time?: string | null
  createdAt?: string | null
  status?: string
  priorityLevel?: string
  title?: string
}

type OverviewRoundReport = {
  id: string
  createdAt?: string | null
  status?: string
  checkpointsTotal?: number
  checkpointsCompleted?: number
  postName?: string
  officerName?: string
}

type OverviewResponse = {
  supervisions?: OverviewSupervision[]
  incidents?: OverviewIncident[]
  roundReports?: OverviewRoundReport[]
  warnings?: string[]
  error?: string
}

export function useOverviewData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState<Required<Pick<OverviewResponse, "supervisions" | "incidents" | "roundReports">>>({
    supervisions: [],
    incidents: [],
    roundReports: [],
  })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!user) {
      setData({ supervisions: [], incidents: [], roundReports: [] })
      setError(null)
      setIsLoading(false)
      return
    }

    let isActive = true
    let requestInFlight = false

    const loadOverview = async (withLoading = false) => {
      if (requestInFlight) return
      requestInFlight = true
      if (withLoading) setIsLoading(true)
      setError(null)

      try {
        const response = await fetchInternalApi(
          supabase,
          "/api/overview",
          { method: "GET" },
          { refreshIfMissingToken: false, retryOnUnauthorized: false }
        )
        const body = (await response.json().catch(() => ({}))) as OverviewResponse
        if (!isActive) return

        if (!response.ok) {
          setError(new Error(String(body.error ?? "No se pudo cargar overview.")))
          setData({ supervisions: [], incidents: [], roundReports: [] })
          return
        }

        setData({
          supervisions: Array.isArray(body.supervisions) ? body.supervisions : [],
          incidents: Array.isArray(body.incidents) ? body.incidents : [],
          roundReports: Array.isArray(body.roundReports) ? body.roundReports : [],
        })
      } catch (nextError) {
        if (!isActive) return
        setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar overview."))
        setData({ supervisions: [], incidents: [], roundReports: [] })
      } finally {
        requestInFlight = false
        if (withLoading && isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadOverview(true)
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return
      void loadOverview(false)
    }, 180000)

    return () => {
      isActive = false
      window.clearInterval(timer)
    }
  }, [supabase, user])

  return {
    supervisions: data.supervisions,
    incidents: data.incidents,
    roundReports: data.roundReports,
    isLoading,
    error,
  }
}