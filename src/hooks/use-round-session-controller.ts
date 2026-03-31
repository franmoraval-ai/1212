"use client"

import { useCallback, useEffect, useRef } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { finishRoundSessionWithOffline, sendRoundEventForSessionWithOffline, startRoundSessionWithOffline } from "@/lib/offline-round-session-ops"

type UserIdentity = {
  uid?: string | null
  email?: string | null
  firstName?: string | null
} | null | undefined

type ActiveRoundLike = {
  id?: string
  name?: string
  post?: string
  frequency?: string
} | null

type BulletinContextLike = {
  stationLabel: string
  stationPostName: string
  officerName: string
  roundId: string
  roundName: string
} | null

type ScanEventLike = {
  at: string
  checkpointId?: string
  checkpointName?: string
  type: string
  lat?: number
  lng?: number
  accuracy?: number
  geofenceDistanceMeters?: number
  geofenceInside?: boolean
  fraudFlag?: string | null
}

type FinishPayload = {
  endedAt: string
  status: string
  checkpointsCompleted: number
  checkpointsTotal: number
  notes?: string | null
  reportId?: string | null
}

type UseRoundSessionControllerOptions = {
  supabase: SupabaseClient
  activeRound: ActiveRoundLike
  bulletinContext: BulletinContextLike
  stationLabel: string
  stationPostName: string
  actingOfficerName: string
  stationModeEnabled: boolean
  checkpointCount: number
  user: UserIdentity
  activeSessionId: string | null
  setActiveSessionId: (sessionId: string | null) => void
}

function estimateExpectedEndAt(startedIso: string, frequency: string | undefined) {
  const minutesMatch = String(frequency ?? "").match(/(\d+)/)
  const minutes = Number(minutesMatch?.[1] ?? 30)
  const base = new Date(startedIso).getTime()
  if (Number.isNaN(base)) return null
  return new Date(base + Math.max(5, minutes) * 60 * 1000).toISOString()
}

export function useRoundSessionController({
  supabase,
  activeRound,
  bulletinContext,
  stationLabel,
  stationPostName,
  actingOfficerName,
  stationModeEnabled,
  checkpointCount,
  user,
  activeSessionId,
  setActiveSessionId,
}: UseRoundSessionControllerOptions) {
  const isStartingSessionRef = useRef(false)
  const activeSessionIdRef = useRef<string | null>(activeSessionId)

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId
  }, [activeSessionId])

  const setSessionId = useCallback((sessionId: string | null) => {
    activeSessionIdRef.current = sessionId
    setActiveSessionId(sessionId)
  }, [setActiveSessionId])

  const clearSessionId = useCallback(() => {
    setSessionId(null)
  }, [setSessionId])

  const sendRoundEventForSession = useCallback(async (sessionId: string, event: ScanEventLike, token?: string) => {
    if (!activeRound?.id || !sessionId || !event.checkpointId) return

    await sendRoundEventForSessionWithOffline(supabase, {
      sessionId,
      roundId: activeRound.id,
      checkpointId: event.checkpointId,
      checkpointName: event.checkpointName,
      eventType: event.type,
      token,
      lat: event.lat,
      lng: event.lng,
      accuracy: event.accuracy,
      distanceToTargetMeters: event.geofenceDistanceMeters,
      insideGeofence: event.geofenceInside,
      fraudFlag: event.fraudFlag ?? null,
      capturedAt: event.at,
    })
  }, [activeRound, supabase])

  const startRoundSession = useCallback(async (startedIso: string) => {
    if (!activeRound?.id || activeSessionIdRef.current || isStartingSessionRef.current) return null
    isStartingSessionRef.current = true
    try {
      const context = bulletinContext ?? {
        stationLabel: String(stationLabel || stationPostName || activeRound.post || "").trim(),
        stationPostName: String(stationPostName || activeRound.post || "").trim(),
        officerName: actingOfficerName,
        roundId: String(activeRound.id ?? "").trim(),
        roundName: String(activeRound.name ?? "").trim(),
      }

      const result = await startRoundSessionWithOffline(supabase, {
        roundId: String(activeRound.id ?? "").trim(),
        roundName: context.roundName || String(activeRound.name ?? ""),
        postName: stationModeEnabled ? (context.stationPostName || String(activeRound.post ?? "")) : String(activeRound.post ?? ""),
        officerId: user?.uid ?? user?.email ?? null,
        officerName: context.officerName || actingOfficerName || user?.firstName || user?.email || "OPERADOR",
        startedAt: startedIso,
        expectedEndAt: estimateExpectedEndAt(startedIso, activeRound.frequency),
        checkpointsTotal: checkpointCount,
      })

      const sessionId = String(result.sessionId ?? "").trim()
      if (!sessionId) return null
      setSessionId(sessionId)
      return sessionId
    } catch {
      return null
    } finally {
      isStartingSessionRef.current = false
    }
  }, [actingOfficerName, activeRound, bulletinContext, checkpointCount, setSessionId, stationLabel, stationModeEnabled, stationPostName, supabase, user])

  const finishRoundSession = useCallback(async (payload: FinishPayload) => {
    if (!activeSessionIdRef.current) return
    await finishRoundSessionWithOffline(supabase, {
      sessionId: activeSessionIdRef.current,
      ...payload,
    })
  }, [supabase])

  return {
    activeSessionIdRef,
    sendRoundEventForSession,
    startRoundSession,
    finishRoundSession,
    setSessionId,
    clearSessionId,
  }
}