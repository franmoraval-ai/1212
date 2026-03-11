import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "ho_offline_mutation_queue_v1";
const MAX_RETRY_ATTEMPTS = 8;

type MutationAction = "insert" | "update" | "delete";

type Primitive = string | number | boolean | null;

export interface OfflineMutation {
  id: string;
  table: string;
  action: MutationAction;
  payload?: Record<string, unknown> | Record<string, unknown>[];
  match?: Record<string, Primitive>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface MutationRequest {
  table: string;
  action: MutationAction;
  payload?: Record<string, unknown> | Record<string, unknown>[];
  match?: Record<string, Primitive>;
}

export interface MutationResult {
  ok: boolean;
  queued: boolean;
  error?: string;
}

const SUPERVISIONS_COMPAT_COLUMNS = ["officer_phone", "evidence_bundle", "geo_risk"] as const;

type MutationErrorLike = { message?: string } | null;

function isBrowser() {
  return typeof window !== "undefined";
}

function readQueue(): OfflineMutation[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as OfflineMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveQueue(queue: OfflineMutation[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function getOfflineQueueSize() {
  return readQueue().length;
}

function isConnectivityError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("internet") ||
    normalized.includes("offline") ||
    normalized.includes("timed out") ||
    normalized.includes("fetch")
  );
}

function getErrorMessage(error: unknown) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "");
  }
  return String(error);
}

function isSchemaCompatibilityError(message: string) {
  const normalized = message.toLowerCase();
  return SUPERVISIONS_COMPAT_COLUMNS.some((column) => normalized.includes(column));
}

function isDuplicateLikeError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("duplicate supervision submission detected") ||
    normalized.includes("duplicate key value") ||
    normalized.includes("already exists")
  );
}

function isPermanentMutationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("permission denied") ||
    normalized.includes("row-level security") ||
    normalized.includes("violates row-level security") ||
    normalized.includes("invalid input syntax") ||
    normalized.includes("violates") ||
    normalized.includes("null value") ||
    normalized.includes("does not exist") ||
    normalized.includes("column")
  );
}

function isObjectPayload(payload: MutationRequest["payload"]): payload is Record<string, unknown> {
  return !!payload && !Array.isArray(payload) && typeof payload === "object";
}

function buildSupervisionCompatPayload(payload: MutationRequest["payload"]) {
  if (!isObjectPayload(payload)) return payload;
  const fallback = { ...payload };
  for (const key of SUPERVISIONS_COMPAT_COLUMNS) {
    delete fallback[key];
  }
  return fallback;
}

function getInsertPayloadId(payload: MutationRequest["payload"]) {
  if (!isObjectPayload(payload)) return null;
  const rawId = payload.id;
  if (typeof rawId !== "string") return null;
  const id = rawId.trim();
  return id || null;
}

function queueMutation(request: MutationRequest, error?: string): OfflineMutation {
  const queue = readQueue();
  const insertPayloadId = request.action === "insert" ? getInsertPayloadId(request.payload) : null;

  // Evita duplicar en cola el mismo insert por id, tipico en doble click/reintento.
  if (insertPayloadId) {
    const existing = queue.find(
      (item) =>
        item.table === request.table &&
        item.action === "insert" &&
        getInsertPayloadId(item.payload) === insertPayloadId
    );
    if (existing) {
      existing.lastError = error ?? existing.lastError;
      saveQueue(queue);
      return existing;
    }
  }

  const item: OfflineMutation = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    table: request.table,
    action: request.action,
    payload: request.payload,
    match: request.match,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: error,
  };

  queue.push(item);
  saveQueue(queue);
  return item;
}

async function executeOnline(supabase: SupabaseClient, request: MutationRequest): Promise<MutationErrorLike> {
  try {
    if (request.action === "insert") {
      const { error } = await supabase.from(request.table).insert(request.payload ?? {});
      return error;
    }

    if (request.action === "update") {
      let query = supabase.from(request.table).update(request.payload ?? {});
      for (const [key, value] of Object.entries(request.match ?? {})) {
        query = query.eq(key, value);
      }
      const { error } = await query;
      return error;
    }

    let query = supabase.from(request.table).delete();
    for (const [key, value] of Object.entries(request.match ?? {})) {
      query = query.eq(key, value);
    }
    const { error } = await query;
    return error;
  } catch (error) {
    return { message: getErrorMessage(error) || "Error inesperado ejecutando mutacion." };
  }
}

async function executeOnlineWithCompatibility(supabase: SupabaseClient, request: MutationRequest): Promise<MutationErrorLike> {
  let error = await executeOnline(supabase, request);
  if (!error) return null;

  const message = getErrorMessage(error);
  if (
    request.table === "supervisions" &&
    request.action === "insert" &&
    isSchemaCompatibilityError(message)
  ) {
    error = await executeOnline(supabase, {
      ...request,
      payload: buildSupervisionCompatPayload(request.payload),
    });
  }

  return error;
}

export async function runMutationWithOffline(
  supabase: SupabaseClient,
  request: MutationRequest
): Promise<MutationResult> {
  const online = !isBrowser() || window.navigator.onLine;

  if (!online) {
    queueMutation(request, "offline");
    return { ok: true, queued: true };
  }

  const error = await executeOnlineWithCompatibility(supabase, request);
  if (!error) return { ok: true, queued: false };

  const message = getErrorMessage(error);
  if (isConnectivityError(message)) {
    queueMutation(request, message);
    return { ok: true, queued: true };
  }

  return { ok: false, queued: false, error: message || "No se pudo ejecutar la operación." };
}

export async function flushOfflineMutations(supabase: SupabaseClient) {
  const queue = readQueue();
  if (!queue.length) return { synced: 0, failed: 0, pending: 0, dropped: 0 };

  let synced = 0;
  let failed = 0;
  let dropped = 0;
  const pending: OfflineMutation[] = [];

  for (const item of queue) {
    const error = await executeOnlineWithCompatibility(supabase, {
      table: item.table,
      action: item.action,
      payload: item.payload,
      match: item.match,
    });

    if (!error) {
      synced += 1;
      continue;
    }

    const message = getErrorMessage(error);
    if (isDuplicateLikeError(message)) {
      // Duplicados bloqueados por BD se consideran sincronizados para liberar cola.
      synced += 1;
      continue;
    }

    const nextAttempts = item.attempts + 1;

    if (isConnectivityError(message)) {
      if (nextAttempts < MAX_RETRY_ATTEMPTS) {
        pending.push({ ...item, attempts: nextAttempts, lastError: message });
      } else {
        dropped += 1;
      }
      failed += 1;
      continue;
    }

    if (isPermanentMutationError(message) || nextAttempts >= MAX_RETRY_ATTEMPTS) {
      dropped += 1;
      failed += 1;
      continue;
    }

    pending.push({ ...item, attempts: nextAttempts, lastError: message });
    failed += 1;
  }

  saveQueue(pending);
  return { synced, failed, pending: pending.length, dropped };
}
