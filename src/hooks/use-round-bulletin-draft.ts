"use client"

import { useEffect, useRef } from "react"

const ACTIVE_BULLETIN_STORAGE_KEY = "ho_active_round_bulletin_v1"
const MAX_BULLETIN_AGE_MS = 12 * 60 * 60 * 1000

type UserIdentity = {
  uid?: string | null
  email?: string | null
} | null | undefined

type BulletinDraftState = {
  activeRoundId: string
  startedAt: string | null
  activeSessionId: string | null
  pendingStartByQr: boolean
  startQrValidated: boolean
  checkpointState: unknown[]
  scanEvents: unknown[]
  photos: string[]
  gpsTrack: unknown[]
  distanceMeters: number
  elapsedSeconds: number
  notes: string
  preRoundCondition: string
  preRoundNotes: string
  bulletinContext: Record<string, unknown> | null
}

export type StoredRoundBulletinDraft = Partial<BulletinDraftState> & {
  userKey?: string
  savedAt?: string
}

type UseRoundBulletinDraftOptions = {
  user: UserIdentity
  state: BulletinDraftState
  onRestore: (stored: StoredRoundBulletinDraft) => void
}

function readStoredBulletin() {
  if (typeof window === "undefined") return null
  try {
    const raw = window.localStorage.getItem(ACTIVE_BULLETIN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredRoundBulletinDraft
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function persistStoredBulletin(payload: Record<string, unknown>) {
  if (typeof window === "undefined") return

  try {
    window.localStorage.setItem(ACTIVE_BULLETIN_STORAGE_KEY, JSON.stringify(payload))
    return
  } catch {
    const fallbackPayload = {
      ...payload,
      photos: [],
    }

    try {
      window.localStorage.setItem(ACTIVE_BULLETIN_STORAGE_KEY, JSON.stringify(fallbackPayload))
    } catch {
      // Si el dispositivo no soporta mas almacenamiento local, conservamos el estado en memoria.
    }
  }
}

function clearStoredBulletin() {
  if (typeof window === "undefined") return
  window.localStorage.removeItem(ACTIVE_BULLETIN_STORAGE_KEY)
}

export function useRoundBulletinDraft({ user, state, onRestore }: UseRoundBulletinDraftOptions) {
  const onRestoreRef = useRef(onRestore)
  const lastRestoredDraftKeyRef = useRef<string | null>(null)
  const currentUserKey = String(user?.uid ?? user?.email ?? "").trim().toLowerCase()

  useEffect(() => {
    onRestoreRef.current = onRestore
  }, [onRestore])

  useEffect(() => {
    if (!currentUserKey) return
    const stored = readStoredBulletin()
    if (!stored) return

    const savedAt = new Date(String(stored.savedAt ?? "")).getTime()
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > MAX_BULLETIN_AGE_MS) {
      clearStoredBulletin()
      return
    }

    const storedUserKey = String(stored.userKey ?? "").trim().toLowerCase()
    if (!currentUserKey || !storedUserKey || currentUserKey !== storedUserKey) return

    const restoreKey = `${storedUserKey}:${String(stored.savedAt ?? "")}`
    if (lastRestoredDraftKeyRef.current === restoreKey) return

    lastRestoredDraftKeyRef.current = restoreKey
    onRestoreRef.current(stored)
  }, [currentUserKey])

  useEffect(() => {
    if (!currentUserKey) return
    const hasActiveBulletin = Boolean(
      state.activeRoundId && (state.startedAt || state.pendingStartByQr || state.activeSessionId || state.checkpointState.length > 0)
    )

    if (!hasActiveBulletin) {
      clearStoredBulletin()
      return
    }

    persistStoredBulletin({
      userKey: currentUserKey,
      savedAt: new Date().toISOString(),
      ...state,
    })
  }, [currentUserKey, state])
}