#!/usr/bin/env node
/**
 * Read-only migration auditor.
 *
 * Parses each supabase/*.sql migration for the tables and columns it creates,
 * then probes the live database (PostgREST, service role) to check whether
 * those objects already exist. This reconciles supabase/.migrations-applied.json
 * with production reality without executing any SQL.
 *
 * Usage:
 *   node scripts/audit-migrations.mjs          — print a read-only audit report
 *   node scripts/audit-migrations.mjs --write  — also mark fully-verified
 *                                                 migrations as applied in state
 *
 * Detection notes:
 *   - Migrations that only create/alter TABLES and COLUMNS are verifiable via
 *     PostgREST. If every table/column they introduce exists, they are "applied".
 *   - Migrations that only change POLICIES, FUNCTIONS, TRIGGERS, or INDEXES
 *     cannot be verified through PostgREST and are reported as "unverifiable".
 *     Their live status must be trusted from deploy history.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */

import fs from "node:fs/promises"
import path from "node:path"

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")
const SUPABASE_DIR = path.join(ROOT, "supabase")
const STATE_FILE = path.join(SUPABASE_DIR, ".migrations-applied.json")
const SKIP_PREFIXES = ["schema", "diagnostic_", "verify_"]

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
  const content = await fs.readFile(path.join(ROOT, ".env.local"), "utf-8")
  return parseEnvFile(content)
}

function isMigrationFile(name) {
  if (!name.endsWith(".sql")) return false
  const lower = name.toLowerCase()
  return !SKIP_PREFIXES.some((prefix) => lower.startsWith(prefix))
}

async function discoverMigrations() {
  const files = await fs.readdir(SUPABASE_DIR)
  return files.filter(isMigrationFile).sort()
}

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

const RE_CREATE_TABLE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?"?([a-z0-9_]+)"?/i
const RE_ALTER_TABLE = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?"?([a-z0-9_]+)"?/i
const RE_ADD_COLUMN = /add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/i

/**
 * Parse a migration's SQL into the set of tables it creates and the
 * (table, column) pairs it adds. Tracks the "current table" from the most
 * recent CREATE/ALTER TABLE statement so multi-line ALTER ... ADD COLUMN
 * blocks attribute columns to the right table.
 */
function parseMigration(sql) {
  const tables = new Set()
  const columns = [] // { table, column }
  let currentTable = null

  for (const rawLine of sql.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("--")) continue

    const createMatch = line.match(RE_CREATE_TABLE)
    if (createMatch) {
      currentTable = createMatch[1].toLowerCase()
      tables.add(currentTable)
      continue
    }

    const alterMatch = line.match(RE_ALTER_TABLE)
    if (alterMatch) {
      currentTable = alterMatch[1].toLowerCase()
    }

    const addColMatch = line.match(RE_ADD_COLUMN)
    if (addColMatch && currentTable) {
      columns.push({ table: currentTable, column: addColMatch[1].toLowerCase() })
    }
  }

  return { tables: [...tables], columns }
}

/**
 * Probe a table (and optionally a column) via PostgREST.
 * Returns "exists" | "missing" | "error:<detail>".
 */
async function probe(baseUrl, serviceKey, table, column) {
  const select = column ? encodeURIComponent(column) : "*"
  const url = `${baseUrl.replace(/\/$/, "")}/rest/v1/${table}?select=${select}&limit=1`
  try {
    const res = await fetch(url, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        Accept: "application/json",
      },
    })
    if (res.ok) return "exists"
    const text = await res.text()
    const lower = text.toLowerCase()
    if (res.status === 404 || lower.includes("could not find") || lower.includes("does not exist") || lower.includes("relation")) {
      return "missing"
    }
    if (lower.includes("column") && lower.includes("does not exist")) return "missing"
    return `error:${res.status}`
  } catch (error) {
    return `error:${error instanceof Error ? error.message : "unknown"}`
  }
}

async function main() {
  const write = process.argv.includes("--write")
  const env = await loadEnv()
  const baseUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim()
  if (!baseUrl || !serviceKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local")
    process.exit(1)
  }

  const [migrations, state] = await Promise.all([discoverMigrations(), readState()])
  const appliedSet = new Set(state.map((e) => e.file))

  // Cache table existence to avoid duplicate probes.
  const tableCache = new Map()
  async function probeTable(table) {
    if (!tableCache.has(table)) tableCache.set(table, await probe(baseUrl, serviceKey, table))
    return tableCache.get(table)
  }

  const verified = []
  const partial = []
  const unverifiable = []
  const missing = []

  for (const file of migrations) {
    const sql = await fs.readFile(path.join(SUPABASE_DIR, file), "utf-8")
    const { tables, columns } = parseMigration(sql)

    if (tables.length === 0 && columns.length === 0) {
      unverifiable.push(file)
      continue
    }

    const checks = []
    for (const table of tables) {
      checks.push({ label: table, status: await probeTable(table) })
    }
    for (const { table, column } of columns) {
      // Skip column checks on tables that are missing entirely.
      const tableStatus = await probeTable(table)
      if (tableStatus === "missing") {
        checks.push({ label: `${table}.${column}`, status: "missing" })
        continue
      }
      checks.push({ label: `${table}.${column}`, status: await probe(baseUrl, serviceKey, table, column) })
    }

    const allExist = checks.every((c) => c.status === "exists")
    const anyMissing = checks.some((c) => c.status === "missing")
    const anyError = checks.some((c) => c.status.startsWith("error"))

    if (allExist) {
      verified.push({ file, checks })
    } else if (anyMissing && !anyError) {
      missing.push({ file, checks })
    } else {
      partial.push({ file, checks })
    }
  }

  const fmt = (checks) => checks.map((c) => `${c.label}=${c.status}`).join(", ")

  console.log(`\n  Migration audit against ${baseUrl}`)
  console.log(`  Total migrations: ${migrations.length} | tracked applied: ${state.length}\n`)

  console.log(`  ✓ VERIFIED live (all tables/columns exist): ${verified.length}`)
  for (const { file, checks } of verified) {
    const tag = appliedSet.has(file) ? "already-tracked" : "NOT-tracked"
    console.log(`    ✓ ${file}  [${tag}]  (${fmt(checks)})`)
  }

  console.log(`\n  ○ UNVERIFIABLE via REST (policies/functions/indexes only): ${unverifiable.length}`)
  for (const file of unverifiable) {
    const tag = appliedSet.has(file) ? "already-tracked" : "trust-history"
    console.log(`    ○ ${file}  [${tag}]`)
  }

  if (partial.length > 0) {
    console.log(`\n  ⚠ PARTIAL / probe error: ${partial.length}`)
    for (const { file, checks } of partial) {
      console.log(`    ⚠ ${file}  (${fmt(checks)})`)
    }
  }

  if (missing.length > 0) {
    console.log(`\n  ✗ MISSING objects (likely NOT applied): ${missing.length}`)
    for (const { file, checks } of missing) {
      console.log(`    ✗ ${file}  (${fmt(checks)})`)
    }
  }

  if (write) {
    const next = [...state]
    let added = 0
    for (const { file } of verified) {
      if (!appliedSet.has(file)) {
        next.push({ file, appliedAt: new Date().toISOString(), verifiedBy: "audit-migrations" })
        appliedSet.add(file)
        added += 1
      }
    }
    if (added > 0) {
      await writeState(next)
      console.log(`\n  Wrote ${added} verified migration(s) to state file.`)
    } else {
      console.log(`\n  No new verified migrations to write.`)
    }
  } else {
    console.log(`\n  (read-only) Run with --write to record VERIFIED migrations in state.`)
  }
  console.log()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
