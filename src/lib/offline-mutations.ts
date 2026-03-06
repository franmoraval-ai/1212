import type { SupabaseClient } from "@supabase/supabase-js";

const STORAGE_KEY = "ho_offline_mutation_queue_v1";

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

function queueMutation(request: MutationRequest, error?: string): OfflineMutation {
  const queue = readQueue();
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

async function executeOnline(supabase: SupabaseClient, request: MutationRequest) {
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

  const error = await executeOnline(supabase, request);
  if (!error) return { ok: true, queued: false };

  const message = String(error.message ?? "");
  if (isConnectivityError(message)) {
    queueMutation(request, message);
    return { ok: true, queued: true };
  }

  return { ok: false, queued: false, error: message || "No se pudo ejecutar la operación." };
}

export async function flushOfflineMutations(supabase: SupabaseClient) {
  const queue = readQueue();
  if (!queue.length) return { synced: 0, failed: 0, pending: 0 };

  let synced = 0;
  let failed = 0;
  const pending: OfflineMutation[] = [];

  for (const item of queue) {
    const error = await executeOnline(supabase, {
      table: item.table,
      action: item.action,
      payload: item.payload,
      match: item.match,
    });

    if (!error) {
      synced += 1;
      continue;
    }

    const message = String(error.message ?? "");
    if (isConnectivityError(message)) {
      pending.push({ ...item, attempts: item.attempts + 1, lastError: message });
      failed += 1;
      continue;
    }

    pending.push({ ...item, attempts: item.attempts + 1, lastError: message });
    failed += 1;
  }

  saveQueue(pending);
  return { synced, failed, pending: pending.length };
}
