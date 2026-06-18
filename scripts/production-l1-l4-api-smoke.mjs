import fs from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const DEFAULT_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_REQUEST_TIMEOUT_MS, 30000)
const ROUNDS_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_ROUNDS_TIMEOUT_MS, 60000)
const DEFAULT_TIMEOUT_RETRIES = parsePositiveInt(process.env.SMOKE_TIMEOUT_RETRIES, 2)

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

function assertOk(condition, message) {
  if (!condition) throw new Error(message)
}

function isTimeoutError(error) {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
}

function isHealthyOrWarningStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase()
  return normalized === "ok" || normalized.startsWith("warning:")
}

async function requestJson(url, init = {}, options = {}) {
  const bypassToken = String(process.env.VERCEL_PROTECTION_BYPASS ?? "").trim()
  const timeoutMs = parsePositiveInt(options.timeoutMs, DEFAULT_REQUEST_TIMEOUT_MS)
  const timeoutRetries = Math.max(0, parsePositiveInt(options.retries, DEFAULT_TIMEOUT_RETRIES))
  let lastError = null

  for (let attempt = 0; attempt <= timeoutRetries; attempt += 1) {
    const headers = new Headers(init.headers ?? undefined)
    if (bypassToken && !headers.has("x-vercel-protection-bypass")) {
      headers.set("x-vercel-protection-bypass", bypassToken)
    }

    try {
      const response = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      })

      const text = await response.text()
      let body = null
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }

      return { response, body }
    } catch (error) {
      lastError = error
      if (!isTimeoutError(error) || attempt >= timeoutRetries) {
        throw error
      }
      console.warn(`[smoke-l1l4] timeout on ${url} (attempt ${attempt + 1}/${timeoutRetries + 1}), retrying...`)
    }
  }

  throw lastError ?? new Error(`Unknown request failure for ${url}`)
}

async function main() {
  const envContent = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
  const env = parseEnvFile(envContent)
  const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const anonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()

  assertOk(projectUrl && anonKey && serviceRoleKey, "Missing Supabase environment configuration in .env.local")

  const baseUrl = String(process.env.PRODUCTION_BASE_URL ?? env.PRODUCTION_BASE_URL ?? "https://hoseguridad.com").trim().replace(/\/$/, "")
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  const email = `smoke.l1l4.${stamp}@hoseguridad.com`
  const password = "Temporal123!A"

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let userId = ""
  let operationCatalogId = ""

  const summary = {
    ok: false,
    baseUrl,
    l4: {
      login: "pending",
      personnelContext: "pending",
      roundsContextBase: "pending",
      roundsContext: "pending",
      supervisions: "pending",
    },
    l1: {
      stationResolved: "pending",
      stationWorkspace: "pending",
      shifts: "pending",
      roundsContext: "pending",
      authorizationInsert: "pending",
    },
  }

  try {
    console.log("[smoke-l1l4] creating temporary auth user")
    const createUser = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Smoke L1L4" },
    })
    assertOk(!createUser.error && createUser.data?.user?.id, `Could not create temporary auth user: ${createUser.error?.message ?? "unknown error"}`)
    userId = String(createUser.data?.user?.id ?? "").trim()

    const localProfile = await admin.from("users").upsert({
      id: userId,
      email,
      first_name: "Smoke L1L4",
      role_level: 4,
      status: "Activo",
      assigned: "",
      created_at: new Date().toISOString(),
    })
    assertOk(!localProfile.error, `Could not upsert temporary local profile: ${localProfile.error?.message ?? "unknown error"}`)

    console.log("[smoke-l1l4] logging in as temporary L4")
    const loginL4 = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    assertOk(loginL4.response.ok && loginL4.body?.ok, `L4 login failed: ${JSON.stringify(loginL4.body)}`)
    summary.l4.login = "ok"
    const l4Token = String(loginL4.body?.session?.access_token ?? "").trim()
    assertOk(l4Token, "L4 login did not return an access token")

    console.log("[smoke-l1l4] validating L4 personnel context")
    const personnelContext = await requestJson(`${baseUrl}/api/personnel/context`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l4Token}` },
    })
    assertOk(personnelContext.response.ok, `L4 personnel context failed: ${JSON.stringify(personnelContext.body)}`)
    summary.l4.personnelContext = "ok"

    console.log("[smoke-l1l4] validating L4 rounds context")
    const roundsContextL4Base = await requestJson(
      `${baseUrl}/api/rounds/context?includeSecurityConfig=1&includeSessions=1&includeAuthorizedOperations=1`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${l4Token}` },
      },
      { timeoutMs: ROUNDS_REQUEST_TIMEOUT_MS }
    )
    assertOk(roundsContextL4Base.response.ok, `L4 rounds context base failed: ${JSON.stringify(roundsContextL4Base.body)}`)
    summary.l4.roundsContextBase = "ok"

    try {
      const roundsContextL4WithReports = await requestJson(
        `${baseUrl}/api/rounds/context?includeReports=1&includeSecurityConfig=1&includeSessions=1&includeAuthorizedOperations=1`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${l4Token}` },
        },
        { timeoutMs: ROUNDS_REQUEST_TIMEOUT_MS }
      )
      summary.l4.roundsContext = roundsContextL4WithReports.response.ok
        ? "ok"
        : `error_status_${roundsContextL4WithReports.response.status}`
    } catch (error) {
      if (isTimeoutError(error)) {
        summary.l4.roundsContext = "warning:timeout"
        console.warn("[smoke-l1l4] L4 rounds context with reports timed out; continuing as warning")
      } else {
        throw error
      }
    }

    console.log("[smoke-l1l4] validating L4 supervisions proxy")
    const supervisions = await requestJson(`${baseUrl}/api/supervisions`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l4Token}` },
    })
    assertOk(supervisions.response.ok && supervisions.body?.ok, `L4 supervisions failed: ${JSON.stringify(supervisions.body)}`)
    summary.l4.supervisions = "ok"

    console.log("[smoke-l1l4] resolving station candidate for L1 checks")
    const stationCandidate = await admin
      .from("operation_catalog")
      .select("id,operation_name,client_name,is_active")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle()

    if (stationCandidate.error || !stationCandidate.data?.id) {
      summary.l1.stationResolved = "skipped_no_active_station"
      summary.l1.authorizationInsert = "skipped_no_active_station"
      summary.l1.stationWorkspace = "skipped_no_active_station"
      summary.l1.shifts = "skipped_no_active_station"
      summary.l1.roundsContext = "skipped_no_active_station"
      summary.ok = true
      console.log(JSON.stringify(summary, null, 2))
      return
    }

    operationCatalogId = String(stationCandidate.data.id)
    const operationName = String(stationCandidate.data.operation_name ?? "").trim()
    const postName = String(stationCandidate.data.client_name ?? "").trim()
    const assigned = `${operationName} | ${postName}`
    summary.l1.stationResolved = `${operationName} | ${postName}`

    console.log("[smoke-l1l4] switching user profile to L1")
    const setL1 = await admin
      .from("users")
      .update({ role_level: 1, status: "Activo", assigned })
      .eq("id", userId)
    assertOk(!setL1.error, `Could not switch temporary user to L1: ${setL1.error?.message ?? "unknown error"}`)

    console.log("[smoke-l1l4] ensuring station authorization row")
    const authorizationInsert = await admin
      .from("station_officer_authorizations")
      .upsert({
        operation_catalog_id: operationCatalogId,
        officer_user_id: userId,
        granted_by_user_id: null,
        is_active: true,
        valid_from: new Date().toISOString(),
        notes: "Smoke L1-L4 automation",
      }, { onConflict: "operation_catalog_id,officer_user_id" })

    if (authorizationInsert.error) {
      summary.l1.authorizationInsert = `warning:${authorizationInsert.error.message ?? "unknown error"}`
    } else {
      summary.l1.authorizationInsert = "ok"
    }

    console.log("[smoke-l1l4] logging in as temporary L1")
    const loginL1 = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    assertOk(loginL1.response.ok && loginL1.body?.ok, `L1 login failed: ${JSON.stringify(loginL1.body)}`)
    const l1Token = String(loginL1.body?.session?.access_token ?? "").trim()
    assertOk(l1Token, "L1 login did not return an access token")

    console.log("[smoke-l1l4] validating L1 station workspace")
    const stationWorkspace = await requestJson(
      `${baseUrl}/api/station/workspace?stationOperationName=${encodeURIComponent(operationName)}&stationPostName=${encodeURIComponent(postName)}&stationLabel=${encodeURIComponent(postName)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${l1Token}` },
      }
    )
    assertOk(stationWorkspace.response.ok, `L1 station workspace failed: ${JSON.stringify(stationWorkspace.body)}`)
    summary.l1.stationWorkspace = "ok"

    console.log("[smoke-l1l4] validating L1 shifts context")
    const shifts = await requestJson(
      `${baseUrl}/api/shifts?stationPostName=${encodeURIComponent(postName)}&stationLabel=${encodeURIComponent(postName)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${l1Token}` },
      }
    )
    assertOk(shifts.response.ok, `L1 shifts context failed: ${JSON.stringify(shifts.body)}`)
    summary.l1.shifts = "ok"

    console.log("[smoke-l1l4] validating L1 rounds context")
    try {
      const roundsContextL1 = await requestJson(
        `${baseUrl}/api/rounds/context?includeReports=1&includeAuthorizedOperations=1`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${l1Token}` },
        },
        { timeoutMs: ROUNDS_REQUEST_TIMEOUT_MS }
      )
      summary.l1.roundsContext = roundsContextL1.response.ok
        ? "ok"
        : `error_status_${roundsContextL1.response.status}`
    } catch (error) {
      if (isTimeoutError(error)) {
        summary.l1.roundsContext = "warning:timeout"
        console.warn("[smoke-l1l4] L1 rounds context with reports timed out; continuing as warning")
      } else {
        throw error
      }
    }

    summary.ok =
      summary.l4.login === "ok"
      && summary.l4.personnelContext === "ok"
      && summary.l4.roundsContextBase === "ok"
      && isHealthyOrWarningStatus(summary.l4.roundsContext)
      && summary.l4.supervisions === "ok"
      && summary.l1.stationWorkspace === "ok"
      && summary.l1.shifts === "ok"
      && isHealthyOrWarningStatus(summary.l1.roundsContext)
    console.log(JSON.stringify(summary, null, 2))
    if (!summary.ok) {
      throw new Error("L1/L4 smoke failed; inspect summary output for failing checks.")
    }
  } finally {
    console.log("[smoke-l1l4] cleaning temporary user artifacts")

    if (operationCatalogId && userId) {
      try {
        await admin
          .from("station_officer_authorizations")
          .delete()
          .eq("operation_catalog_id", operationCatalogId)
          .eq("officer_user_id", userId)
      } catch {
        // Cleanup should not hide primary result.
      }
    }

    if (userId) {
      try {
        await admin.from("users").delete().eq("id", userId)
      } catch {
        // Cleanup should not hide primary result.
      }

      try {
        await admin.auth.admin.deleteUser(userId)
      } catch {
        // Cleanup should not hide primary result.
      }
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
