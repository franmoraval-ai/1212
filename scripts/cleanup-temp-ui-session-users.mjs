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

async function main() {
  const envRaw = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
  const env = parseEnvFile(envRaw)
  const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  const admin = createClient(projectUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const raw = await fs.readFile(new URL("./tmp-ui-session-users.json", import.meta.url), "utf8")
  const data = JSON.parse(raw)

  const l4UserId = String(data?.l4?.userId ?? "").trim()
  const l1UserId = String(data?.l1?.userId ?? "").trim()
  const operationCatalogId = String(data?.station?.operationCatalogId ?? "").trim()

  if (operationCatalogId && l1UserId) {
    try {
      await admin
        .from("station_officer_authorizations")
        .delete()
        .eq("operation_catalog_id", operationCatalogId)
        .eq("officer_user_id", l1UserId)
    } catch {
      // Ignore cleanup issues.
    }
  }

  for (const userId of [l4UserId, l1UserId]) {
    if (!userId) continue
    try {
      await admin.from("users").delete().eq("id", userId)
    } catch {
      // Ignore cleanup issues.
    }
    try {
      await admin.auth.admin.deleteUser(userId)
    } catch {
      // Ignore cleanup issues.
    }
  }

  console.log(JSON.stringify({ ok: true, removed: [l4UserId, l1UserId].filter(Boolean) }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
