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

  const raw = await fs.readFile(new URL("./tmp-ui-l2-l3-session-users.json", import.meta.url), "utf8")
  const data = JSON.parse(raw)

  const userIds = [
    String(data?.l2?.userId ?? "").trim(),
    String(data?.l3?.userId ?? "").trim(),
  ].filter(Boolean)

  for (const userId of userIds) {
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

  console.log(JSON.stringify({ ok: true, removed: userIds }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error))
  process.exitCode = 1
})
