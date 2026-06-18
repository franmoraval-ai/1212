import fs from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

function parseEnvFile(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const idx = line.indexOf("=")
    if (idx <= 0) continue
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return env
}

function assertOk(condition, message) {
  if (!condition) throw new Error(message)
}

async function ensureAuthUser(admin, { email, password, firstName }) {
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName },
  })

  if (created.error) {
    throw new Error(`Could not create auth user ${email}: ${created.error.message}`)
  }

  const userId = String(created.data?.user?.id ?? "").trim()
  assertOk(userId, `Missing user id for ${email}`)
  return userId
}

async function main() {
  const envRaw = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
  const env = parseEnvFile(envRaw)

  const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  assertOk(projectUrl && serviceRoleKey, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")

  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const station = await admin
    .from("operation_catalog")
    .select("operation_name,client_name,is_active")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle()

  assertOk(!station.error && station.data, `Could not resolve active station: ${station.error?.message ?? "not found"}`)

  const operationName = String(station.data?.operation_name ?? "").trim()
  const postName = String(station.data?.client_name ?? "").trim()
  const assigned = operationName && postName ? `${operationName} | ${postName}` : ""

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  const l2Email = `ui.l2.${stamp}@hoseguridad.com`
  const l3Email = `ui.l3.${stamp}@hoseguridad.com`
  const password = "Temporal123!A"

  const l2UserId = await ensureAuthUser(admin, { email: l2Email, password, firstName: "UI L2" })
  const l3UserId = await ensureAuthUser(admin, { email: l3Email, password, firstName: "UI L3" })

  const upsertL2 = await admin.from("users").upsert({
    id: l2UserId,
    email: l2Email,
    first_name: "UI L2",
    role_level: 2,
    status: "Activo",
    assigned,
    created_at: new Date().toISOString(),
  })
  if (upsertL2.error) throw new Error(`Could not upsert L2 profile: ${upsertL2.error.message}`)

  const upsertL3 = await admin.from("users").upsert({
    id: l3UserId,
    email: l3Email,
    first_name: "UI L3",
    role_level: 3,
    status: "Activo",
    assigned,
    created_at: new Date().toISOString(),
  })
  if (upsertL3.error) throw new Error(`Could not upsert L3 profile: ${upsertL3.error.message}`)

  const payload = {
    ok: true,
    createdAt: new Date().toISOString(),
    l2: { email: l2Email, password, userId: l2UserId },
    l3: { email: l3Email, password, userId: l3UserId },
    assigned,
  }

  const filePayload = {
    ...payload,
    l2: { email: l2Email, userId: l2UserId },
    l3: { email: l3Email, userId: l3UserId },
  }

  await fs.writeFile(new URL("./tmp-ui-l2-l3-session-users.json", import.meta.url), JSON.stringify(filePayload, null, 2), "utf8")
  console.log(`[ui-smoke] password preset for this session users: ${password}`)
  console.log(JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
