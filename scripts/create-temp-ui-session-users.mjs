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

  const stationQuery = await admin
    .from("station_profiles")
    .select("operation_catalog_id,is_enabled,operation_catalog:operation_catalog_id(id,operation_name,client_name,is_active)")
    .eq("is_enabled", true)
    .limit(10)

  if (stationQuery.error) {
    throw new Error(`Could not read station profiles: ${stationQuery.error.message}`)
  }

  const stationRow = (stationQuery.data ?? []).find((row) => {
    const catalog = row.operation_catalog
    return catalog && catalog.is_active !== false
  })

  assertOk(stationRow, "No active enabled station profile found for temporary L1 user")

  const catalog = stationRow.operation_catalog
  const operationCatalogId = String(catalog.id ?? "").trim()
  const operationName = String(catalog.operation_name ?? "").trim()
  const postName = String(catalog.client_name ?? "").trim()
  assertOk(operationCatalogId && operationName && postName, "Station profile catalog row is incomplete")

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
  const l4Email = `ui.l4.${stamp}@hoseguridad.com`
  const l1Email = `ui.l1.${stamp}@hoseguridad.com`
  const password = "Temporal123!A"

  const l4UserId = await ensureAuthUser(admin, { email: l4Email, password, firstName: "UI L4" })
  const l1UserId = await ensureAuthUser(admin, { email: l1Email, password, firstName: "UI L1" })

  const l4Profile = await admin.from("users").upsert({
    id: l4UserId,
    email: l4Email,
    first_name: "UI L4",
    role_level: 4,
    status: "Activo",
    assigned: "",
    created_at: new Date().toISOString(),
  })
  if (l4Profile.error) throw new Error(`Could not upsert L4 profile: ${l4Profile.error.message}`)

  const l1Profile = await admin.from("users").upsert({
    id: l1UserId,
    email: l1Email,
    first_name: "UI L1",
    role_level: 1,
    status: "Activo",
    assigned: `${operationName} | ${postName}`,
    created_at: new Date().toISOString(),
  })
  if (l1Profile.error) throw new Error(`Could not upsert L1 profile: ${l1Profile.error.message}`)

  const authorization = await admin
    .from("station_officer_authorizations")
    .upsert({
      operation_catalog_id: operationCatalogId,
      officer_user_id: l1UserId,
      granted_by_user_id: l4UserId,
      is_active: true,
      valid_from: new Date().toISOString(),
      notes: "UI smoke session user",
    }, { onConflict: "operation_catalog_id,officer_user_id" })

  if (authorization.error) {
    throw new Error(`Could not upsert station authorization: ${authorization.error.message}`)
  }

  const payload = {
    ok: true,
    createdAt: new Date().toISOString(),
    l4: { email: l4Email, password, userId: l4UserId },
    l1: { email: l1Email, password, userId: l1UserId },
    station: { operationCatalogId, operationName, postName },
  }

  const filePayload = {
    ...payload,
    l4: { email: l4Email, userId: l4UserId },
    l1: { email: l1Email, userId: l1UserId },
  }

  await fs.writeFile(new URL("./tmp-ui-session-users.json", import.meta.url), JSON.stringify(filePayload, null, 2), "utf8")
  console.log(`[ui-smoke] password preset for this session users: ${password}`)
  console.log(JSON.stringify(payload, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
