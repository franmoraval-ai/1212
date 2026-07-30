"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { useSharedRefreshLoop } from "./use-shared-poll"

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
  resolutionNote?: string
  resolvedAt?: string | null
  resolvedByUserId?: string
  resolvedByEmail?: string
  assignedToUserId?: string
  assignedToEmail?: string
  assignedToName?: string
  assignedAt?: string | null
  assignedByUserId?: string
  assignedByEmail?: string
}

export type IncidentAssignee = {
  id: string
  name: string
  email: string
  roleLevel: number
  assigned: string
}

type IncidentsResponse = {
  incidents?: IncidentRecord[]
  assignees?: IncidentAssignee[]
  error?: string
}

export function useIncidentsData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [incidents, setIncidents] = useState<IncidentRecord[]>([])
  const [assignees, setAssignees] = useState<IncidentAssignee[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadIncidents = useCallback(async (withLoading = false) => {
    if (!user) {
      setIncidents([])
      setAssignees([])
      setError(null)
      setIsLoading(false)
      return
    }

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        "/api/incidents?includeAssignees=1",
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
      setAssignees(Array.isArray(body.assignees) ? body.assignees : [])
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudieron cargar los incidentes."))
      setIncidents([])
      setAssignees([])
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) {
      setIncidents([])
      setAssignees([])
      setError(null)
      setIsLoading(false)
    }
  }, [loadIncidents, user])

  useSharedRefreshLoop({ enabled: Boolean(user), intervalMs: 180000, reload: loadIncidents })

  return {
    incidents,
    assignees,
    isLoading,
    error,
    reload: loadIncidents,
  }
}