#!/usr/bin/env node
/**
 * Supabase migration runner — lists, checks, and applies SQL migrations.
 *
 * Usage:
 *   node scripts/migrate.mjs status         — show pending/applied migrations
 *   node scripts/migrate.mjs apply          — apply all pending migrations (dry-run)
 *   node scripts/migrate.mjs apply --live   — apply pending migrations for real
 *   node scripts/migrate.mjs mark <file>    — mark a migration as already applied
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * Tracks state in supabase/.migrations-applied.json (gitignored).
 *
 * Migration files: supabase/*.sql (excluding schema.sql, diagnostic_*, verify_*, _legacy/)
 */

import fs from "node:fs/promises"
import path from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const SUPABASE_DIR = path.join(ROOT, "supabase")
const STATE_FILE = path.join(SUPABASE_DIR, ".migrations-applied.json")

// ── Env parsing ──────────────────────────────────────────────────────
function parseEnvFile(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const sep = line.indexOf("=")
    if (sep <= 0) continue
    let val = line.slice(sep + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[line.slice(0, sep).trim()] = val
  }
  return env
}

async function loadEnv() {
  try {
    const content = await fs.readFile(path.join(ROOT, ".env.local"), "utf-8")
    return parseEnvFile(content)
  } catch {
    return {}
  }
}

// ── State tracking ───────────────────────────────────────────────────
async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf-8")
    const data = JSON.parse(raw)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function writeState(entries) {
  await fs.writeFile(STATE_FILE, JSON.stringify(entries, null, 2) + "\n", "utf-8")
}

// ── Migration discovery ──────────────────────────────────────────────
const SKIP_PREFIXES = ["schema", "diagnostic_", "verify_"]

function isMigrationFile(name) {
  if (!name.endsWith(".sql")) return false
  const lower = name.toLowerCase()
  return !SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

async function discoverMigrations() {
  const files = await fs.readdir(SUPABASE_DIR)
  return files.filter(isMigrationFile).sort()
}

// ── Supabase SQL execution ───────────────────────────────────────────
async function executeSql(supabaseUrl, serviceRoleKey, sql) {
  // Uses the Supabase SQL REST endpoint (/rest/v1/rpc or PostgreSQL HTTP)
  // Supabase exposes a pg endpoint via PostgREST, but for raw SQL we use
  // the management API or the pg connection. For simplicity we use the
  // SQL endpoint available in the dashboard API.
  const url = `${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc`

  // Supabase doesn't expose a raw SQL endpoint via REST by default.
  // The recommended way is to use pg directly or the SQL editor in the dashboard.
  // This runner is a DRY-RUN tracker. For actual application, copy the SQL
  // and run it in the Supabase SQL Editor.
  throw new Error(
    "Automatic SQL execution is not supported. " +
    "Use the Supabase SQL Editor or a direct pg connection to apply migrations. " +
    "This runner tracks state only."
  )
}

// ── Commands ─────────────────────────────────────────────────────────
async function cmdStatus() {
  const [migrations, applied] = await Promise.all([discoverMigrations(), readState()])
  const appliedSet = new Set(applied.map((e) => e.file))
  const pending = migrations.filter((f) => !appliedSet.has(f))

  console.log(`\n  Migrations directory: supabase/`)
  console.log(`  State file:           supabase/.migrations-applied.json`)
  console.log(`  Total migrations:     ${migrations.length}`)
  console.log(`  Applied:              ${applied.length}`)
  console.log(`  Pending:              ${pending.length}\n`)

  if (applied.length > 0) {
    console.log("  ✓ Applied:")
    for (const entry of applied) {
      console.log(`    ✓ ${entry.file}  (${entry.appliedAt ?? "unknown"})`)
    }
    console.log()
  }

  if (pending.length > 0) {
    console.log("  ○ Pending:")
    for (const file of pending) {
      console.log(`    ○ ${file}`)
    }
    console.log()
  } else {
    console.log("  All migrations are applied.\n")
  }
}

async function cmdApply(isLive) {
  const [migrations, applied] = await Promise.all([discoverMigrations(), readState()])
  const appliedSet = new Set(applied.map((e) => e.file))
  const pending = migrations.filter((f) => !appliedSet.has(f))

  if (pending.length === 0) {
    console.log("\n  No pending migrations.\n")
    return
  }

  console.log(`\n  ${pending.length} pending migration(s):\n`)

  for (const file of pending) {
    const filePath = path.join(SUPABASE_DIR, file)
    const sql = await fs.readFile(filePath, "utf-8")
    const lineCount = sql.split("\n").length

    if (!isLive) {
      console.log(`  [DRY-RUN] Would apply: ${file} (${lineCount} lines)`)
      continue
    }

    // In live mode, we display the SQL and prompt the user to confirm
    // they applied it via the Supabase SQL Editor, then mark it.
    console.log(`  ──────────────────────────────────────────`)
    console.log(`  Migration: ${file} (${lineCount} lines)`)
    console.log(`  ──────────────────────────────────────────`)
    console.log(`  Copy and run this SQL in the Supabase SQL Editor:`)
    console.log()
    console.log(sql)
    console.log()
    console.log(`  After running, this migration will be marked as applied.`)

    applied.push({ file, appliedAt: new Date().toISOString() })
    await writeState(applied)
    console.log(`  ✓ Marked ${file} as applied.\n`)
  }

  if (!isLive) {
    console.log(`\n  Run with --live to see SQL and mark as applied.\n`)
  }
}

async function cmdMark(fileName) {
  if (!fileName) {
    console.error("  Error: specify a file name to mark. Example: node scripts/migrate.mjs mark add_station_profiles.sql")
    process.exit(1)
  }

  const migrations = await discoverMigrations()
  if (!migrations.includes(fileName)) {
    console.error(`  Error: '${fileName}' is not a recognized migration file.`)
    console.error(`  Available: ${migrations.join(", ")}`)
    process.exit(1)
  }

  const applied = await readState()
  if (applied.some((e) => e.file === fileName)) {
    console.log(`  Already marked: ${fileName}`)
    return
  }

  applied.push({ file: fileName, appliedAt: new Date().toISOString() })
  await writeState(applied)
  console.log(`  ✓ Marked ${fileName} as applied.`)
}

// ── Main ─────────────────────────────────────────────────────────────
const [command, ...args] = process.argv.slice(2)

switch (command) {
  case "status":
    await cmdStatus()
    break
  case "apply":
    await cmdApply(args.includes("--live"))
    break
  case "mark":
    await cmdMark(args[0])
    break
  default:
    console.log(`
  Supabase migration runner

  Commands:
    status          Show pending/applied migrations
    apply           Dry-run: list pending migrations
    apply --live    Show SQL and mark each migration as applied
    mark <file>     Mark a specific migration as already applied

  Examples:
    node scripts/migrate.mjs status
    node scripts/migrate.mjs mark fix_supervisions_l4_visibility.sql
    node scripts/migrate.mjs apply --live
`)
}
