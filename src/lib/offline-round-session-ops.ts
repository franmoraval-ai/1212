import type { SupabaseClient } from "@supabase/supabase-js"

const STORAGE_KEY = "ho_offline_round_session_ops_v1"
const DROPPED_STORAGE_KEY = "ho_offline_round_session_ops_dead_letter_v1"
const SESSION_MAP_KEY = "ho_offline_round_session_map_v1"
export const OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT = "ho:offline-round-session-ops-changed"
const MAX_RETRY_ATTEMPTS = 8

type RoundSessionOperationKind = "start" | "event" | "finish"

type RoundSessionStartPayload = {
  localSessionId: string
  roundId: string
  roundName?: string
  postName?: string
  officerId?: string | null
  officerName?: string
  startedAt: string
  expectedEndAt?: string | null
  checkpointsTotal: number
}

type RoundSessionEventPayload = {
  sessionId: string
  roundId: string
  checkpointId: string
  checkpointName?: string
  eventType: string
  token?: string
  lat?: number
  lng?: number
  accuracy?: number
  distanceToTargetMeters?: number
  insideGeofence?: boolean
  fraudFlag?: string | null
  capturedAt?: string
}

type RoundSessionFinishPayload = {
  sessionId: string
  endedAt: string
  status: string
  checkpointsCompleted: number
  checkpointsTotal: number
  notes?: string | null
  reportId?: string | null
}

type RoundSessionOperationPayload = RoundSessionStartPayload | RoundSessionEventPayload | RoundSessionFinishPayload

type RoundSessionOperation = {
  id: string
  kind: RoundSessionOperationKind
  sessionId: string
  payload: RoundSessionOperationPayload
  createdAt: string
  attempts: number
  lastError?: string
}

type DroppedRoundSessionOperation = RoundSessionOperation & {
  droppedAt: string
  dropReason: string
}

type QueueRoundSessionResult = {
  ok: boolean
  queued: boolean
  sessionId?: string
  error?: string
}

function isBrowser() {
  return typeof window !== "undefined"
}

function notifyQueueChanged() {
  if (!isBrowser()) return
  window.dispatchEvent(new CustomEvent(OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT))
}

function readQueue() {
  if (!isBrowser()) return [] as RoundSessionOperation[]
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as RoundSessionOperation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveQueue(queue: RoundSessionOperation[]) {
  if (!isBrowser()) return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
  notifyQueueChanged()
}

function readDroppedQueue() {
  if (!isBrowser()) return [] as DroppedRoundSessionOperation[]
  try {
    const raw = window.localStorage.getItem(DROPPED_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as DroppedRoundSessionOperation[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function saveDroppedQueue(queue: DroppedRoundSessionOperation[]) {
  if (!isBrowser()) return
  window.localStorage.setItem(DROPPED_STORAGE_KEY, JSON.stringify(queue.slice(0, 200)))
  notifyQueueChanged()
}

function readSessionMap() {
  if (!isBrowser()) return {} as Record<string, string>
  try {
    const raw = window.localStorage.getItem(SESSION_MAP_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

function saveSessionMap(map: Record<string, string>) {
  if (!isBrowser()) return
  window.localStorage.setItem(SESSION_MAP_KEY, JSON.stringify(map))
  notifyQueueChanged()
}

function quarantineDroppedOperation(item: RoundSessionOperation, reason: string) {
  const queue = readDroppedQueue()
  queue.unshift({
    ...item,
    droppedAt: new Date().toISOString(),
    dropReason: reason,
    lastError: reason,
  })
  saveDroppedQueue(queue)
}

function normalizeErrorMessage(error: unknown) {
  if (!error) return ""
  if (typeof error === "string") return error
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "")
  }
  return String(error)
}

function isConnectivityError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("failed to fetch") || normalized.includes("network") || normalized.includes("offline") || normalized.includes("timed out") || normalized.includes("fetch")
}

function isPermanentSessionError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes("no autenticado") || normalized.includes("permiso") || normalized.includes("forbidden") || normalized.includes("row-level security") || normalized.includes("inválido") || normalized.includes("invalido")
}

function isClosedSessionResponse(status: number, message: string) {
  if (status === 409) return true
  return message.toLowerCase().includes("ya está cerrada") || message.toLowerCase().includes("ya esta cerrada")
}

function createOperationId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export function createOfflineRoundSessionId() {
  return `local-round-session-${createOperationId()}`
}

export function getOfflineRoundSessionQueueSize() {
  return readQueue().length
}

export function getDroppedOfflineRoundSessionQueueSize() {
  return readDroppedQueue().length
}

export function getDroppedOfflineRoundSessionQueueSummary() {
  const summary = new Map<string, number>()
  for (const item of readDroppedQueue()) {
    summary.set(item.kind, (summary.get(item.kind) ?? 0) + 1)
  }
  return Array.from(summary.entries()).map(([kind, count]) => ({ kind, count }))
}

function queueOperation(kind: RoundSessionOperationKind, sessionId: string, payload: RoundSessionOperationPayload, error?: string) {
  const queue = readQueue()
  const existingIndex = queue.findIndex((item) => {
    if (item.kind !== kind || item.sessionId !== sessionId) return false
    if (kind === "finish") return true
    if (kind === "start") return true
    if (kind !== "event") return false
    const current = item.payload as RoundSessionEventPayload
    const next = payload as RoundSessionEventPayload
    return current.checkpointId === next.checkpointId && current.eventType === next.eventType && current.capturedAt === next.capturedAt
  })

  if (existingIndex >= 0) {
    queue[existingIndex] = {
      ...queue[existingIndex],
      payload,
      lastError: error ?? queue[existingIndex].lastError,
    }
    saveQueue(queue)
    return queue[existingIndex]
  }

  const nextItem: RoundSessionOperation = {
    id: createOperationId(),
    kind,
    sessionId,
    payload,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: error,
  }
  queue.push(nextItem)
  saveQueue(queue)
  return nextItem
}

async function getAuthHeaders(supabase: SupabaseClient) {
  const { data: sessionData } = await supabase.auth.getSession()
  let accessToken = String(sessionData.session?.access_token ?? "").trim()
  if (!accessToken) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    accessToken = String(refreshed.session?.access_token ?? "").trim()
  }
  return {
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  }
}

async function postJson<TResponse>(supabase: SupabaseClient, path: string, body: Record<string, unknown>) {
  try {
    const headers = await getAuthHeaders(supabase)
    const response = await fetch(path, {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify(body),
    })
    const data = (await response.json().catch(() => ({}))) as TResponse & { error?: string }
    return {
      ok: response.ok,
      status: response.status,
      data,
      error: response.ok ? null : String(data.error ?? "Error inesperado en sesión de ronda."),
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: null as TResponse | null,
      error: normalizeErrorMessage(error) || "No se pudo ejecutar la operación de sesión de ronda.",
    }
  }
}

export function resolveOfflineRoundSessionId(sessionId: string) {
  const sessionMap = readSessionMap()
  return sessionMap[sessionId] ?? sessionId
}

export async function startRoundSessionWithOffline(supabase: SupabaseClient, payload: Omit<RoundSessionStartPayload, "localSessionId"> & { localSessionId?: string }) : Promise<QueueRoundSessionResult> {
  const localSessionId = String(payload.localSessionId ?? "").trim() || createOfflineRoundSessionId()
  const requestPayload: RoundSessionStartPayload = { ...payload, localSessionId }

  if (!isBrowser() || window.navigator.onLine) {
    const response = await postJson<{ sessionId?: string }>(supabase, "/api/rounds/sessions/start", requestPayload)
    if (response.ok) {
      const sessionId = String(response.data?.sessionId ?? "").trim()
      if (sessionId) {
        const sessionMap = readSessionMap()
        sessionMap[localSessionId] = sessionId
        saveSessionMap(sessionMap)
        return { ok: true, queued: false, sessionId }
      }
    }

    const message = String(response.error ?? "")
    if (!isConnectivityError(message)) {
      return { ok: false, queued: false, error: message || "No se pudo iniciar la sesión de ronda." }
    }
  }

  queueOperation("start", localSessionId, requestPayload, "offline")
  return { ok: true, queued: true, sessionId: localSessionId }
}

export async function sendRoundEventForSessionWithOffline(supabase: SupabaseClient, payload: RoundSessionEventPayload): Promise<QueueRoundSessionResult> {
  const mappedSessionId = resolveOfflineRoundSessionId(payload.sessionId)
  const shouldQueueDirectly = mappedSessionId.startsWith("local-round-session-") || (isBrowser() && !window.navigator.onLine)

  if (!shouldQueueDirectly) {
    const response = await postJson<{ ok?: boolean }>(supabase, `/api/rounds/sessions/${encodeURIComponent(mappedSessionId)}/event`, {
      ...payload,
      sessionId: mappedSessionId,
    })
    if (response.ok || isClosedSessionResponse(response.status, String(response.error ?? ""))) {
      return { ok: true, queued: false, sessionId: mappedSessionId }
    }

    const message = String(response.error ?? "")
    if (!isConnectivityError(message)) {
      return { ok: false, queued: false, error: message || "No se pudo guardar el evento de ronda." }
    }
  }

  queueOperation("event", payload.sessionId, payload, "offline")
  return { ok: true, queued: true, sessionId: payload.sessionId }
}

export async function finishRoundSessionWithOffline(supabase: SupabaseClient, payload: RoundSessionFinishPayload): Promise<QueueRoundSessionResult> {
  const mappedSessionId = resolveOfflineRoundSessionId(payload.sessionId)
  const shouldQueueDirectly = mappedSessionId.startsWith("local-round-session-") || (isBrowser() && !window.navigator.onLine)

  if (!shouldQueueDirectly) {
    const response = await postJson<{ ok?: boolean }>(supabase, `/api/rounds/sessions/${encodeURIComponent(mappedSessionId)}/finish`, {
      ...payload,
      sessionId: mappedSessionId,
    })
    if (response.ok || isClosedSessionResponse(response.status, String(response.error ?? ""))) {
      return { ok: true, queued: false, sessionId: mappedSessionId }
    }

    const message = String(response.error ?? "")
    if (!isConnectivityError(message)) {
      return { ok: false, queued: false, error: message || "No se pudo cerrar la sesión de ronda." }
    }
  }

  queueOperation("finish", payload.sessionId, payload, "offline")
  return { ok: true, queued: true, sessionId: payload.sessionId }
}

export async function flushOfflineRoundSessionOperations(supabase: SupabaseClient) {
  const queue = readQueue()
  if (!queue.length) return { synced: 0, failed: 0, pending: 0, dropped: 0 }

  let synced = 0
  let failed = 0
  let dropped = 0
  const pending: RoundSessionOperation[] = []
  const sessionMap = readSessionMap()

  for (const item of queue) {
    if (item.kind === "start") {
      const payload = item.payload as RoundSessionStartPayload
      if (sessionMap[item.sessionId]) {
        synced += 1
        continue
      }

      const response = await postJson<{ sessionId?: string }>(supabase, "/api/rounds/sessions/start", payload)
      if (response.ok) {
        const serverSessionId = String(response.data?.sessionId ?? "").trim()
        if (serverSessionId) {
          sessionMap[item.sessionId] = serverSessionId
          saveSessionMap(sessionMap)
          synced += 1
          continue
        }
      }

      const message = String(response.error ?? "")
      const nextAttempts = item.attempts + 1
      if (isConnectivityError(message)) {
        if (nextAttempts < MAX_RETRY_ATTEMPTS) pending.push({ ...item, attempts: nextAttempts, lastError: message })
        else {
          quarantineDroppedOperation(item, message || "Exceso de reintentos iniciando sesión offline.")
          dropped += 1
        }
        failed += 1
        continue
      }

      if (isPermanentSessionError(message) || nextAttempts >= MAX_RETRY_ATTEMPTS) {
        quarantineDroppedOperation(item, message || "Error permanente iniciando sesión offline.")
        dropped += 1
        failed += 1
        continue
      }

      pending.push({ ...item, attempts: nextAttempts, lastError: message })
      failed += 1
      continue
    }

    const mappedSessionId = sessionMap[item.sessionId] ?? item.sessionId
    if (mappedSessionId.startsWith("local-round-session-")) {
      const hasPendingStart = queue.some((candidate) => candidate.kind === "start" && candidate.sessionId === item.sessionId)
      if (!hasPendingStart) {
        quarantineDroppedOperation(item, "La sesión offline asociada ya no existe y la operación quedó huérfana.")
        dropped += 1
        failed += 1
        continue
      }
      pending.push(item)
      continue
    }

    const path = item.kind === "event"
      ? `/api/rounds/sessions/${encodeURIComponent(mappedSessionId)}/event`
      : `/api/rounds/sessions/${encodeURIComponent(mappedSessionId)}/finish`
    const payload = { ...(item.payload as Record<string, unknown>), sessionId: mappedSessionId }
    const response = await postJson<{ ok?: boolean }>(supabase, path, payload)
    if (response.ok || isClosedSessionResponse(response.status, String(response.error ?? ""))) {
      synced += 1
      continue
    }

    const message = String(response.error ?? "")
    const nextAttempts = item.attempts + 1
    if (isConnectivityError(message)) {
      if (nextAttempts < MAX_RETRY_ATTEMPTS) pending.push({ ...item, attempts: nextAttempts, lastError: message })
      else {
        quarantineDroppedOperation(item, message || "Exceso de reintentos sincronizando sesión offline.")
        dropped += 1
      }
      failed += 1
      continue
    }

    if (isPermanentSessionError(message) || nextAttempts >= MAX_RETRY_ATTEMPTS) {
      quarantineDroppedOperation(item, message || "Error permanente sincronizando sesión offline.")
      dropped += 1
      failed += 1
      continue
    }

    pending.push({ ...item, attempts: nextAttempts, lastError: message })
    failed += 1
  }

  saveQueue(pending)
  return { synced, failed, pending: pending.length, dropped }
}