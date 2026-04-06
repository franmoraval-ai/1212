"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type IncidentRecord = {
  id: string
  time?: string | null
  createdAt?: string | null
  incidentType?: string
  location?: string
  description?: string
  priorityLevel?: string
  status?: string
  reportedByUserId?: string
  reportedByEmail?: string
}

type IncidentsResponse = {
  incidents?: IncidentRecord[]
  error?: string
}

export function useIncidentsData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadIncidents = useCallback(async (withLoading = false) => {
    if (!user) {
      setIncidents([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/incidents",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as IncidentsResponse

      if (!response.ok) {
        setError(new Error(String(body.error ?? "No se pudieron cargar los incidentes.")))
        setIncidents([])
        return
      }

      setIncidents(Array.isArray(body.incidents) ? body.incidents : [])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudieron cargar los incidentes."))
      setIncidents([])
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setIncidents([])
      setError(null)
      setIsLoading(false)
      return
    }

    let isActive = true
    let requestInFlight = false

    const runLoad = async (withLoading = false) => {
      if (!isActive || requestInFlight) return
      requestInFlight = true
      await loadIncidents(withLoading)
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
  }, [loadIncidents, user])

  return {
    incidents,
    isLoading,
    error,
    reload: loadIncidents,
  }
}