import type { SupabaseClient } from "@supabase/supabase-js"

function clearBrowserStorage(storage: Storage | undefined) {
  if (!storage) return

  const keysToRemove: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (!key) continue
    if (key.startsWith("ho_") || key.startsWith("sb-")) {
      keysToRemove.push(key)
    }
  }

  keysToRemove.forEach((key) => storage.removeItem(key))
}

function clearAuthCookies() {
  if (typeof document === "undefined") return

  const cookieNames = document.cookie
    .split(";")
    .map((entry) => entry.split("=")[0]?.trim())
    .filter(Boolean)

  cookieNames.forEach((name) => {
    if (!name) return
    if (name.startsWith("sb-") || name.includes("supabase") || name.includes("auth-token")) {
      document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`
      document.cookie = `${name}=; Max-Age=0; path=/; domain=${window.location.hostname}; SameSite=Lax`
    }
  })
}

export async function performClientSignOut(supabase: SupabaseClient, redirectTo = "/login") {
  let accessToken = ""

  try {
    const { data } = await supabase.auth.getSession()
    accessToken = String(data.session?.access_token ?? "").trim()
  } catch {
    accessToken = ""
  }

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      credentials: "include",
      cache: "no-store",
    })
  } catch {
    // Continue with local cleanup even if the server route fails.
  }

  if (typeof window !== "undefined") {
    clearBrowserStorage(window.localStorage)
    clearBrowserStorage(window.sessionStorage)
    clearAuthCookies()
  }

  if (typeof window !== "undefined") {
    window.location.replace(`${redirectTo}${redirectTo.includes("?") ? "&" : "?"}logout=${Date.now()}`)
  }
}