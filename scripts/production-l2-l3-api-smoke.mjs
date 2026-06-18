import fs from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

const DEFAULT_REQUEST_TIMEOUT_MS = parsePositiveInt(process.env.SMOKE_REQUEST_TIMEOUT_MS, 30000)
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
      console.warn(`[smoke-l2l3] timeout on ${url} (attempt ${attempt + 1}/${timeoutRetries + 1}), retrying...`)
    }
  }

  throw lastError ?? new Error(`Unknown request failure for ${url}`)
}

async function createTempUser(admin, { email, password, firstName, roleLevel, assigned }) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName },
  })

  if (created.error) {
    throw new Error(`Could not create temporary auth user ${email}: ${created.error.message}`)
  }

  const userId = String(created.data?.user?.id ?? "").trim()
  assertOk(userId, `Temporary auth user ${email} returned empty id`)

  const upsertResult = await admin.from("users").upsert({
    id: userId,
    email,
    first_name: firstName,
    role_level: roleLevel,
    status: "Activo",
    assigned,
    created_at: new Date().toISOString(),
  })

  if (upsertResult.error) {
    throw new Error(`Could not upsert local profile for ${email}: ${upsertResult.error.message}`)
  }

  return userId
}

async function cleanupTempUser(admin, userId) {
  if (!userId) return

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

function assertStatus(result, expectedStatuses, label) {
  const allowed = new Set(expectedStatuses)
  const status = Number(result.response?.status ?? 0)
  if (!allowed.has(status)) {
    throw new Error(`${label} expected status ${Array.from(allowed).join("|")}, got ${status}: ${JSON.stringify(result.body)}`)
  }
}

async function main() {
  const envContent = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
  const env = parseEnvFile(envContent)

  const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  assertOk(projectUrl && serviceRoleKey, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")

  const baseUrl = String(process.env.PRODUCTION_BASE_URL ?? env.PRODUCTION_BASE_URL ?? "https://hoseguridad.com").trim().replace(/\/$/, "")
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  const l2Email = `smoke.l2.${stamp}@hoseguridad.com`
  const l3Email = `smoke.l3.${stamp}@hoseguridad.com`
  const password = "Temporal123!A"

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let l2UserId = ""
  let l3UserId = ""

  const stationCandidate = await admin
    .from("operation_catalog")
    .select("operation_name,client_name,is_active")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  const operationName = String(stationCandidate.data?.operation_name ?? "").trim()
  const postName = String(stationCandidate.data?.client_name ?? "").trim()
  const assigned = operationName && postName ? `${operationName} | ${postName}` : ""

  const summary = {
    ok: false,
    baseUrl,
    assigned,
    l2: {
      email: l2Email,
      login: "pending",
      supervisionContext: "pending",
      internalNotes: "pending",
      attendanceSummaryDenied: "pending",
      shiftMutationDenied: "pending",
    },
    l3: {
      email: l3Email,
      login: "pending",
      overview: "pending",
      personnelContext: "pending",
      internalNotes: "pending",
      attendanceSummaryDenied: "pending",
      shiftMutationDenied: "pending",
    },
  }

  try {
    console.log("[smoke-l2l3] creating temporary L2/L3 users")
    l2UserId = await createTempUser(admin, {
      email: l2Email,
      password,
      firstName: "Smoke L2",
      roleLevel: 2,
      assigned,
    })

    l3UserId = await createTempUser(admin, {
      email: l3Email,
      password,
      firstName: "Smoke L3",
      roleLevel: 3,
      assigned,
    })

    console.log("[smoke-l2l3] logging in as L2")
    const loginL2 = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: l2Email, password }),
    })
    assertOk(loginL2.response.ok && loginL2.body?.ok, `L2 login failed: ${JSON.stringify(loginL2.body)}`)
    summary.l2.login = "ok"
    const l2Token = String(loginL2.body?.session?.access_token ?? "").trim()
    assertOk(l2Token, "L2 login did not return access token")

    console.log("[smoke-l2l3] validating L2 allowed endpoints")
    const l2SupervisionContext = await requestJson(`${baseUrl}/api/supervision/context?includeReports=0`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l2Token}` },
    })
    assertStatus(l2SupervisionContext, [200], "L2 /api/supervision/context")
    summary.l2.supervisionContext = "ok"

    const l2InternalNotes = await requestJson(`${baseUrl}/api/internal-notes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l2Token}` },
    })
    assertStatus(l2InternalNotes, [200], "L2 /api/internal-notes")
    summary.l2.internalNotes = "ok"

    console.log("[smoke-l2l3] validating L2 denied endpoints")
    const l2AttendanceSummary = await requestJson(`${baseUrl}/api/personnel/attendance-summary?days=30`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l2Token}` },
    })
    assertStatus(l2AttendanceSummary, [403], "L2 /api/personnel/attendance-summary")
    summary.l2.attendanceSummaryDenied = "ok"

    const l2ShiftMutation = await requestJson(`${baseUrl}/api/shifts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${l2Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "check_in" }),
    })
    assertStatus(l2ShiftMutation, [403], "L2 POST /api/shifts")
    summary.l2.shiftMutationDenied = "ok"

    console.log("[smoke-l2l3] logging in as L3")
    const loginL3 = await requestJson(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: l3Email, password }),
    })
    assertOk(loginL3.response.ok && loginL3.body?.ok, `L3 login failed: ${JSON.stringify(loginL3.body)}`)
    summary.l3.login = "ok"
    const l3Token = String(loginL3.body?.session?.access_token ?? "").trim()
    assertOk(l3Token, "L3 login did not return access token")

    console.log("[smoke-l2l3] validating L3 allowed endpoints")
    const l3Overview = await requestJson(`${baseUrl}/api/overview`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l3Token}` },
    })
    assertStatus(l3Overview, [200], "L3 /api/overview")
    summary.l3.overview = "ok"

    const l3PersonnelContext = await requestJson(`${baseUrl}/api/personnel/context`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l3Token}` },
    })
    assertStatus(l3PersonnelContext, [200], "L3 /api/personnel/context")
    summary.l3.personnelContext = "ok"

    const l3InternalNotes = await requestJson(`${baseUrl}/api/internal-notes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l3Token}` },
    })
    assertStatus(l3InternalNotes, [200], "L3 /api/internal-notes")
    summary.l3.internalNotes = "ok"

    console.log("[smoke-l2l3] validating L3 denied endpoints")
    const l3AttendanceSummary = await requestJson(`${baseUrl}/api/personnel/attendance-summary?days=30`, {
      method: "GET",
      headers: { Authorization: `Bearer ${l3Token}` },
    })
    assertStatus(l3AttendanceSummary, [403], "L3 /api/personnel/attendance-summary")
    summary.l3.attendanceSummaryDenied = "ok"

    const l3ShiftMutation = await requestJson(`${baseUrl}/api/shifts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${l3Token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "check_in" }),
    })
    assertStatus(l3ShiftMutation, [403], "L3 POST /api/shifts")
    summary.l3.shiftMutationDenied = "ok"

    summary.ok =
      summary.l2.login === "ok"
      && summary.l2.supervisionContext === "ok"
      && summary.l2.internalNotes === "ok"
      && summary.l2.attendanceSummaryDenied === "ok"
      && summary.l2.shiftMutationDenied === "ok"
      && summary.l3.login === "ok"
      && summary.l3.overview === "ok"
      && summary.l3.personnelContext === "ok"
      && summary.l3.internalNotes === "ok"
      && summary.l3.attendanceSummaryDenied === "ok"
      && summary.l3.shiftMutationDenied === "ok"

    console.log(JSON.stringify(summary, null, 2))
  } finally {
    console.log("[smoke-l2l3] cleaning temporary users")
    await cleanupTempUser(admin, l2UserId)
    await cleanupTempUser(admin, l3UserId)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
