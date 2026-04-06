import fs from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

const REQUEST_TIMEOUT_MS = 30000

function parseEnvFile(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    env[key] = value
  }
  return env
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await response.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { response, body }
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const envContent = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
  const env = parseEnvFile(envContent)
  const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const anonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()

  assertOk(projectUrl && anonKey && serviceRoleKey, "Missing Supabase environment configuration in .env.local")

  const baseUrl = "https://hoseguridad.com"
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  const email = `smoke.l4.${stamp}@hoseguridad.com`
  const passwordA = "Temporal123!A"
  const passwordB = "Temporal123!B"

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let userId = ""

  try {
    console.log("[smoke] checking public login page")
    const loginPage = await fetch(`${baseUrl}/login`, { cache: "no-store" })
    assertOk(loginPage.ok, `GET /login failed with status ${loginPage.status}`)

    console.log("[smoke] creating temporary user through production signup route")
    const signup = await requestJson(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: "Smoke L4",
        email,
        password: passwordA,
      }),
    })
    assertOk(signup.response.ok && signup.body?.ok, `Production signup failed: ${JSON.stringify(signup.body)}`)

    console.log("[smoke] promoting temporary local profile to L4 for validation")
    const localUserLookup = await admin
      .from("users")
      .select("id,email")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()
    assertOk(!localUserLookup.error, `Lookup in public.users failed: ${localUserLookup.error?.message ?? "unknown error"}`)
    userId = String(localUserLookup.data?.id ?? "").trim()
    assertOk(userId, "Signup created no local users row")

    const localUser = await admin
      .from("users")
      .update({
        role_level: 4,
        status: "Activo",
        assigned: "",
      })
      .eq("id", userId)
    assertOk(!localUser.error, `Update of temporary local user failed: ${localUser.error?.message ?? "unknown error"}`)

    console.log("[smoke] validating production login route")
    const loginA = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: passwordA }),
    })
    assertOk(loginA.response.ok && loginA.body?.ok, `Production login failed: ${JSON.stringify(loginA.body)}`)
    const accessTokenA = String(loginA.body?.session?.access_token ?? "").trim()
    assertOk(accessTokenA, "Production login returned no access token")

    console.log("[smoke] validating protected L4 proxy route")
    const l4Proxy = await requestJson(`${baseUrl}/api/supervisions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessTokenA}` },
    })
    assertOk(l4Proxy.response.ok && l4Proxy.body?.ok, `Protected /api/supervisions failed: ${JSON.stringify(l4Proxy.body)}`)

    console.log("[smoke] checking direct L4 RLS against Supabase REST")
    const l4DirectRls = await requestJson(`${projectUrl}/rest/v1/supervisions?select=id&limit=1`, {
      method: "GET",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessTokenA}`,
      },
    })

    console.log("[smoke] validating password update route")
    const updatePassword = await requestJson(`${baseUrl}/api/auth/update-password`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessTokenA}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: passwordB }),
    })
    assertOk(updatePassword.response.ok && updatePassword.body?.ok, `Update password failed: ${JSON.stringify(updatePassword.body)}`)

    console.log("[smoke] validating login with new password")
    const loginB = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: passwordB }),
    })
    assertOk(loginB.response.ok && loginB.body?.ok, `Login with updated password failed: ${JSON.stringify(loginB.body)}`)

    console.log("[smoke] validating recovery route")
    const recover = await requestJson(`${baseUrl}/api/auth/recover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, redirectTo: `${baseUrl}/login` }),
    })
    assertOk(recover.response.ok && recover.body?.ok, `Recover route failed: ${JSON.stringify(recover.body)}`)

    console.log("[smoke] validating logout route")
    const logout = await requestJson(`${baseUrl}/api/auth/logout`, {
      method: "POST",
    })
    assertOk(logout.response.ok && logout.body?.ok, `Logout route failed: ${JSON.stringify(logout.body)}`)

    console.log(JSON.stringify({
      ok: true,
      loginPageStatus: loginPage.status,
      loginRoute: "ok",
      l4ProxyRoute: Array.isArray(l4Proxy.body?.records) ? l4Proxy.body.records.length : 0,
      l4DirectRlsStatus: l4DirectRls.response.status,
      l4DirectRlsBody: l4DirectRls.body,
      updatePassword: "ok",
      loginWithNewPassword: "ok",
      recoverRoute: "ok",
      logoutRoute: "ok",
      smokeUser: email,
    }, null, 2))
  } finally {
    console.log("[smoke] cleaning temporary user")
    if (userId) {
      await admin.from("users").delete().eq("id", userId).catch(() => undefined)
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})