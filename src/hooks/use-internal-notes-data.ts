"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"

export type InternalNoteRecord = {
  id: string
  postName?: string
  category?: string
  priority?: string
  detail?: string
  status?: string
  reportedByUserId?: string
  reportedByName?: string
  reportedByEmail?: string
  assignedTo?: string
  resolutionNote?: string
  createdAt?: string | null
  updatedAt?: string | null
  resolvedAt?: string | null
}

type InternalNotesResponse = {
  notes?: InternalNoteRecord[]
  openCount?: number
  overdueCount?: number
  error?: string
}

const EMPTY_STATE = {
  notes: [] as InternalNoteRecord[],
  openCount: 0,
  overdueCount: 0,
}

export function useInternalNotesData() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [data, setData] = useState(EMPTY_STATE)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const loadNotes = useCallback(async (withLoading = false) => {
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
        "/api/internal-notes",
        { method: "GET" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = (await response.json().catch(() => ({}))) as InternalNotesResponse

      if (!response.ok) {
        setError(new Error(String(body.error ?? "No se pudieron cargar las novedades internas.")))
        setData(EMPTY_STATE)
        return
      }

      setData({
        notes: Array.isArray(body.notes) ? body.notes : [],
        openCount: Number(body.openCount ?? 0),
        overdueCount: Number(body.overdueCount ?? 0),
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError : new Error("No se pudieron cargar las novedades internas."))
      setData(EMPTY_STATE)
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

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
      await loadNotes(withLoading)
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
  }, [loadNotes, user])

  return {
    notes: data.notes,
    openCount: data.openCount,
    overdueCount: data.overdueCount,
    isLoading,
    error,
    reload: loadNotes,
  }
}