import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "ho_offline_mutation_queue_v1";
const DROPPED_STORAGE_KEY = "ho_offline_mutation_dead_letter_v1";
export const OFFLINE_MUTATIONS_CHANGED_EVENT = "ho:offline-mutations-changed";
const MAX_RETRY_ATTEMPTS = 8;
const MAX_LOCAL_MUTATION_BYTES = 2_000_000;

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

export function getQueuedOfflineMutationsByTable<TPayload = Record<string, unknown>>(table: string) {
  return readQueue().filter((item) => item.table === table).map((item) => ({
    ...item,
    payload: item.payload as TPayload | TPayload[] | undefined,
  }))
}

interface DroppedOfflineMutation extends OfflineMutation {
  droppedAt: string;
  dropReason: string;
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
  window.dispatchEvent(new CustomEvent(OFFLINE_MUTATIONS_CHANGED_EVENT));
}

function readDroppedQueue(): DroppedOfflineMutation[] {
  if (!isBrowser()) return [];
  try {
    const raw = window.localStorage.getItem(DROPPED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DroppedOfflineMutation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDroppedQueue(queue: DroppedOfflineMutation[]) {
  if (!isBrowser()) return;
  window.localStorage.setItem(DROPPED_STORAGE_KEY, JSON.stringify(queue.slice(0, 200)));
  window.dispatchEvent(new CustomEvent(OFFLINE_MUTATIONS_CHANGED_EVENT));
}

function quarantineDroppedMutation(item: OfflineMutation, reason: string) {
  const queue = readDroppedQueue();
  queue.unshift({
    ...item,
    droppedAt: new Date().toISOString(),
    dropReason: reason,
    lastError: reason,
  });
  saveDroppedQueue(queue);
}

export function getOfflineQueueSize() {
  return readQueue().length;
}

export function getDroppedOfflineQueueSize() {
  return readDroppedQueue().length;
}

export function getDroppedOfflineQueueSummary() {
  const summary = new Map<string, number>();
  for (const item of readDroppedQueue()) {
    const key = String(item.table ?? "desconocido").trim() || "desconocido";
    summary.set(key, (summary.get(key) ?? 0) + 1);
  }
  return Array.from(summary.entries()).map(([table, count]) => ({ table, count }));
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

function getSerializedSizeBytes(value: unknown) {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function exceedsOfflineStorageLimit(request: MutationRequest) {
  if (request.action !== "insert" && request.action !== "update") return false;
  if (request.table !== "round_reports" && request.table !== "supervisions") return false;
  return getSerializedSizeBytes(request.payload) > MAX_LOCAL_MUTATION_BYTES;
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

function queueMutation(request: MutationRequest, error?: string): OfflineMutation | null {
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
      try {
        saveQueue(queue);
      } catch {
        return null;
      }
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
  try {
    saveQueue(queue);
  } catch {
    return null;
  }
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

  if (exceedsOfflineStorageLimit(request)) {
    return {
      ok: false,
      queued: false,
      error: "La boleta es demasiado pesada para guardarse offline en este dispositivo. Reduzca fotos o recupere conexión antes de guardar.",
    };
  }

  if (!online) {
    const queued = queueMutation(request, "offline");
    if (!queued) {
      return {
        ok: false,
        queued: false,
        error: "No hay espacio local para guardar la operación offline. Sincronice o elimine evidencia antes de continuar.",
      };
    }
    return { ok: true, queued: true };
  }

  const error = await executeOnlineWithCompatibility(supabase, request);
  if (!error) return { ok: true, queued: false };

  const message = getErrorMessage(error);
  if (isConnectivityError(message)) {
    const queued = queueMutation(request, message);
    if (!queued) {
      return {
        ok: false,
        queued: false,
        error: "Se perdió la conexión y no hubo espacio local para encolar la operación. Reintente con menos evidencia o recupere señal.",
      };
    }
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
        quarantineDroppedMutation(item, message || "Exceso de reintentos por conectividad.");
        dropped += 1;
      }
      failed += 1;
      continue;
    }

    if (isPermanentMutationError(message) || nextAttempts >= MAX_RETRY_ATTEMPTS) {
      quarantineDroppedMutation(item, message || "Error permanente en sincronización offline.");
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
