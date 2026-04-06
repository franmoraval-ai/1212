"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type StationRoundCard = {
  id: string
  name: string
  post: string
  dueAtMs: number | null
}

export type StationRecentNote = {
  id: string
  priority: string
  detail: string
  reportedByName: string
  createdAt: string | null
}

export type StationRecentIncident = {
  id: string
  priorityLevel: string
  incidentType: string
  description: string
  locationLabel: string
  occurredAt: string | null
}

type StationWorkspaceResponse = {
  roundCards?: StationRoundCard[]
  openNotesCount?: number
  recentStationNotes?: StationRecentNote[]
  openIncidentsCount?: number
  recentStationIncidents?: StationRecentIncident[]
  error?: string
}

const EMPTY_STATE = {
  roundCards: [] as StationRoundCard[],
  openNotesCount: 0,
  recentStationNotes: [] as StationRecentNote[],
  openIncidentsCount: 0,
  recentStationIncidents: [] as StationRecentIncident[],
}

export function useStationWorkspaceData(input: {
  stationOperationName: string
  stationPostName: string
  stationLabel: string
}) {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadWorkspace = useCallback(async (withLoading = false) => {
    if (!user) {
      setData(EMPTY_STATE)
      setError(null)
      setIsLoading(false)
      return
    }

    const params = new URLSearchParams()
    if (input.stationOperationName) params.set("stationOperationName", input.stationOperationName)
    if (input.stationPostName) params.set("stationPostName", input.stationPostName)
    if (input.stationLabel) params.set("stationLabel", input.stationLabel)

    if (withLoading) setIsLoading(true)
    setError(null)

    try {
      const response = await fetchInternalApi(
        supabase,
        `/api/station/workspace?${params.toString()}`,
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as StationWorkspaceResponse

      if (!response.ok) {
        setError(new Error(String(body.error ?? "No se pudo cargar el puesto activo.")))
        setData(EMPTY_STATE)
        return
      }

      setData({
        roundCards: Array.isArray(body.roundCards) ? body.roundCards : [],
        openNotesCount: Number(body.openNotesCount ?? 0),
        recentStationNotes: Array.isArray(body.recentStationNotes) ? body.recentStationNotes : [],
        openIncidentsCount: Number(body.openIncidentsCount ?? 0),
        recentStationIncidents: Array.isArray(body.recentStationIncidents) ? body.recentStationIncidents : [],
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudo cargar el puesto activo."))
      setData(EMPTY_STATE)
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [input.stationLabel, input.stationOperationName, input.stationPostName, supabase, user])

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
      await loadWorkspace(withLoading)
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
  }, [loadWorkspace, user])

  return {
    roundCards: data.roundCards,
    openNotesCount: data.openNotesCount,
    recentStationNotes: data.recentStationNotes,
    openIncidentsCount: data.openIncidentsCount,
    recentStationIncidents: data.recentStationIncidents,
    isLoading,
    error,
    reload: loadWorkspace,
  }
}