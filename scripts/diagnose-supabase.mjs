import fs from "node:fs/promises"
import dns from "node:dns/promises"
import net from "node:net"

function parseEnvFile(content) {
  const env = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    env[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return env
}

async function measure(name, action) {
  const startedAt = Date.now()
  try {
    const result = await action()
    return { name, ok: true, ms: Date.now() - startedAt, result }
  } catch (error) {
    return {
      name,
      ok: false,
      ms: Date.now() - startedAt,
      result: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }
  }
}

async function fetchText(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(15000),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text.slice(0, 400),
  }
}

function tcpProbe(host, port, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket()
    const startedAt = Date.now()
    let settled = false

    const finish = (callback, value) => {
      if (settled) return
      settled = true
      socket.destroy()
      callback(value)
    }

    socket.setTimeout(timeoutMs)
    socket.once("connect", () => finish(resolve, `connected in ${Date.now() - startedAt}ms`))
    socket.once("timeout", () => finish(reject, new Error(`TCP timeout after ${timeoutMs}ms`)))
    socket.once("error", (error) => finish(reject, error))
    socket.connect(port, host)
  })
}

const envContent = await fs.readFile(new URL("../.env.local", import.meta.url), "utf8")
const env = parseEnvFile(envContent)
const projectUrl = String(env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim()
const anonKey = String(env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim()

if (!projectUrl || !anonKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local")
  process.exit(1)
}

const host = new URL(projectUrl).host
const base = projectUrl.replace(/\/+$/, "")

const results = []
results.push(await measure("dns.lookup", async () => (await dns.lookup(host, { all: true })).map((item) => item.address).join(", ")))
results.push(await measure("tcp:443", () => tcpProbe(host, 443)))
results.push(await measure("GET /", () => fetchText(base)))
results.push(await measure("GET /auth/v1/settings", () => fetchText(`${base}/auth/v1/settings`)))
results.push(await measure("GET /rest/v1/", () => fetchText(`${base}/rest/v1/`, {
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
  },
})))
results.push(await measure("POST /auth/v1/token invalid", () => fetchText(`${base}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    Authorization: `Bearer ${anonKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: "smoke.invalid@hoseguridad.com",
    password: "bad-pass",
  }),
})))

console.log(JSON.stringify({ host, results }, null, 2))