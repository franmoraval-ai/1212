import type { SupabaseClient } from "@supabase/supabase-js"

type InternalApiOptions = {
  refreshIfMissingToken?: boolean
  retryOnUnauthorized?: boolean
}

let refreshTokenPromises = new WeakMap<SupabaseClient, Promise<string>>()
let cachedSessionReadPromises = new WeakMap<SupabaseClient, Promise<string>>()

function normalizeAccessToken(value: unknown) {
  return String(value ?? "").trim()
}

async function readAccessToken(supabase: SupabaseClient) {
  const cachedPromise = cachedSessionReadPromises.get(supabase)
  if (cachedPromise) {
    return cachedPromise
  }

  const readPromise = supabase.auth
      .getSession()
      .then(({ data: sessionData }) => normalizeAccessToken(sessionData.session?.access_token))
      .catch(() => "")
      .finally(() => {
        cachedSessionReadPromises.delete(supabase)
      })

  cachedSessionReadPromises.set(supabase, readPromise)

  return readPromise
}

async function refreshAccessToken(supabase: SupabaseClient) {
  const cachedPromise = refreshTokenPromises.get(supabase)
  if (cachedPromise) {
    return cachedPromise
  }

  const refreshPromise = supabase.auth
      .refreshSession()
      .then(({ data }) => normalizeAccessToken(data.session?.access_token))
      .catch(() => "")
      .finally(() => {
        refreshTokenPromises.delete(supabase)
      })

  refreshTokenPromises.set(supabase, refreshPromise)

  return refreshPromise
}

async function buildInternalApiHeaders(
  supabase: SupabaseClient,
  init: RequestInit,
  options: Required<InternalApiOptions>,
  forceRefresh = false
) {
  const headers = new Headers(init.headers ?? undefined)
  const hasBody = init.body !== undefined && init.body !== null

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  let accessToken = forceRefresh ? "" : await readAccessToken(supabase)
  if (!accessToken && options.refreshIfMissingToken) {
    accessToken = await refreshAccessToken(supabase)
  }

  if (accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`)
  }

  return headers
}

export async function fetchInternalApi(
  supabase: SupabaseClient,
  input: string,
  init: RequestInit = {},
  options: InternalApiOptions = {}
) {
  const resolvedOptions: Required<InternalApiOptions> = {
    refreshIfMissingToken: options.refreshIfMissingToken ?? true,
    retryOnUnauthorized: options.retryOnUnauthorized ?? true,
  }

  let response = await fetch(input, {
    ...init,
    headers: await buildInternalApiHeaders(supabase, init, resolvedOptions, false),
    credentials: init.credentials ?? "include",
  })

  if (response.status !== 401 || !resolvedOptions.retryOnUnauthorized) {
    return response
  }

  return fetch(input, {
    ...init,
    headers: await buildInternalApiHeaders(supabase, init, resolvedOptions, true),
    credentials: init.credentials ?? "include",
  })
}

export function __resetInternalApiTokenCacheForTests() {
  cachedSessionReadPromises = new WeakMap<SupabaseClient, Promise<string>>()
  refreshTokenPromises = new WeakMap<SupabaseClient, Promise<string>>()
}