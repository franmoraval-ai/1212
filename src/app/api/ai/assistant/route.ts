import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

const BASE_RECORDS_PER_TABLE = 40
const DEEP_RECORDS_PER_TABLE = 120

type Message = { role: "user" | "assistant"; content: string }

type RequestBody = {
  messages?: unknown[]
}

// ── Detectar rango de fechas en el último mensaje ──────────────────────────────
function detectDateRange(text: string): { since: string; until: string } {
  const now = new Date()
  const t = text.toLowerCase()

  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

  if (t.includes("hoy") || t.includes("today")) {
    const start = new Date(now); start.setHours(0, 0, 0, 0)
    const end = new Date(now); end.setHours(23, 59, 59, 999)
    return { since: start.toISOString(), until: end.toISOString() }
  }
  if (t.includes("ayer") || t.includes("yesterday")) {
    const start = new Date(now); start.setDate(start.getDate() - 1); start.setHours(0, 0, 0, 0)
    const end = new Date(start); end.setHours(23, 59, 59, 999)
    return { since: start.toISOString(), until: end.toISOString() }
  }
  if (t.includes("esta semana") || t.includes("this week")) return { since: daysAgo(7), until: now.toISOString() }
  if (t.includes("semana pasada") || t.includes("last week")) return { since: daysAgo(14), until: daysAgo(7) }
  if (t.includes("este mes") || t.includes("this month")) return { since: daysAgo(30), until: now.toISOString() }
  if (t.includes("mes pasado") || t.includes("last month")) return { since: daysAgo(60), until: daysAgo(30) }

  // Detectar fecha explícita tipo "15 de marzo", "marzo 15", "15/03"
  const monthNames: Record<string, number> = {
    enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5,
    julio: 6, agosto: 7, septiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
  }
  for (const [name, idx] of Object.entries(monthNames)) {
    const match = new RegExp(`(\\d{1,2})\\s+de\\s+${name}|${name}\\s+(\\d{1,2})`).exec(t)
    if (match) {
      const day = Number(match[1] ?? match[2])
      const year = now.getFullYear()
      const start = new Date(year, idx, day, 0, 0, 0)
      const end = new Date(year, idx, day, 23, 59, 59)
      return { since: start.toISOString(), until: end.toISOString() }
    }
  }
  // Formato dd/mm
  const dmMatch = /(\d{1,2})\/(\d{1,2})/.exec(t)
  if (dmMatch) {
    const [, d, m] = dmMatch
    const start = new Date(now.getFullYear(), Number(m) - 1, Number(d), 0, 0, 0)
    const end = new Date(now.getFullYear(), Number(m) - 1, Number(d), 23, 59, 59)
    return { since: start.toISOString(), until: end.toISOString() }
  }

  // Default: últimos 30 días
  return { since: daysAgo(30), until: now.toISOString() }
}

// ── Detectar qué módulos son relevantes ───────────────────────────────────────
type TableKey = "supervisions" | "round_reports" | "incidents" | "visitors" | "weapon_control_logs" | "internal_notes"

function detectRelevantTables(text: string): TableKey[] {
  const t = text.toLowerCase()
  const all: TableKey[] = ["supervisions", "round_reports", "incidents", "visitors", "weapon_control_logs", "internal_notes"]

  const matchers: [TableKey, string[]][] = [
    ["supervisions",       ["supervis", "fiscali", "oficial", "boleta de supervis"]],
    ["round_reports",      ["ronda", "round", "checkpoint", "recorrido", "patrullaje"]],
    ["incidents",          ["incident", "novedad", "event", "accidente", "reporte"]],
    ["visitors",           ["visita", "visitor", "ingreso", "entrada", "acceso", "invitado"]],
    ["weapon_control_logs",["arma", "weapon", "pistola", "fusil", "control de arma", "serie"]],
    ["internal_notes",     ["nota", "note", "interno", "comunicado", "aviso", "memo"]],
  ]

  const genericTerms = ["resumen", "todo", "general", "todos", "cuantos", "dame", "qué pasó", "novedades", "reporte", "hoy", "ayer", "semana", "mes"]
  if (genericTerms.some((g) => t.includes(g))) return all

  const matched = matchers.filter(([, terms]) => terms.some((term) => t.includes(term))).map(([key]) => key)
  return matched.length > 0 ? matched : all
}

function isDeepAnalysisQuery(text: string) {
  const t = text.toLowerCase()
  const deepTerms = ["analisis profundo", "análisis profundo", "detallado", "exhaustivo", "causa", "tendencia", "patron", "patrón", "riesgo"]
  return deepTerms.some((term) => t.includes(term))
}

function extractOperationTerm(text: string) {
  const t = text.toLowerCase()
  const match = /operaci[oó]n(?:\s+|:)([a-z0-9áéíóúñ\s\-]{2,40})/i.exec(t)
  if (!match?.[1]) return ""
  return String(match[1]).trim().replace(/\s+/g, " ")
}

function parseTokens(raw: string | null | undefined) {
  return String(raw ?? "")
    .split(/[|,;]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
}

function rowMatchesScope(
  row: Record<string, unknown>,
  assignedTokens: string[],
  identityTokens: string[],
) {
  const text = Object.values(row)
    .map((value) => String(value ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" ")

  const matchesAssigned = assignedTokens.length > 0 && assignedTokens.some((token) => text.includes(token))
  const matchesIdentity = identityTokens.some((token) => token && text.includes(token))
  return matchesAssigned || matchesIdentity
}

function normalizeMessages(raw: unknown[]): Message[] {
  return raw
    .filter((m) => m && typeof m === "object")
    .map((m) => {
      const msg = m as Record<string, unknown>
      const role: "user" | "assistant" = String(msg.role ?? "user") === "assistant" ? "assistant" : "user"
      return { role, content: String(msg.content ?? "").trim() }
    })
    .filter((m) => m.content.length > 0)
    .slice(-10)
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-CR", {
      dateStyle: "short",
      timeStyle: "short",
    })
  } catch {
    return iso
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDataContext(data: Record<string, any[]>, lineLimitPerTable: number) {
  const lines: string[] = []

  if (data.supervisions?.length) {
    lines.push(`\n## SUPERVISIONES (${data.supervisions.length} registros)`)
    for (const r of data.supervisions.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Oficial: ${r.officer_name ?? "-"} | Puesto: ${r.review_post ?? "-"} | Op: ${r.operation_name ?? "-"} | Estado: ${r.status ?? "-"} | Obs: ${r.observations ?? "-"}`
      )
    }
  }

  if (data.round_reports?.length) {
    lines.push(`\n## RONDAS (${data.round_reports.length} registros)`)
    for (const r of data.round_reports.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Ronda: ${r.round_name ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Estado: ${r.status ?? "-"} | Avance: ${r.checkpoints_completed ?? 0}/${r.checkpoints_total ?? 0} | Notas: ${r.notes ?? "-"}`
      )
    }
  }

  if (data.incidents?.length) {
    lines.push(`\n## INCIDENTES (${data.incidents.length} registros)`)
    for (const r of data.incidents.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Tipo: ${r.type ?? "-"} | Lugar: ${r.location ?? r.lugar ?? "-"} | Estado: ${r.status ?? "-"} | Desc: ${String(r.description ?? r.details ?? "-").slice(0, 120)}`
      )
    }
  }

  if (data.visitors?.length) {
    lines.push(`\n## VISITANTES (${data.visitors.length} registros)`)
    for (const r of data.visitors.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Nombre: ${r.name ?? r.visitor_name ?? "-"} | Destino: ${r.destination ?? r.post ?? "-"} | Estado: ${r.status ?? "-"}`
      )
    }
  }

  if (data.weapon_control_logs?.length) {
    lines.push(`\n## CONTROL DE ARMAS (${data.weapon_control_logs.length} registros)`)
    for (const r of data.weapon_control_logs.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Arma: ${r.weapon_model ?? "-"} | Serie: ${r.weapon_serial ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Accion: ${r.action ?? r.type ?? "-"}`
      )
    }
  }

  if (data.internal_notes?.length) {
    lines.push(`\n## NOTAS INTERNAS (${data.internal_notes.length} registros)`)
    for (const r of data.internal_notes.slice(0, lineLimitPerTable)) {
      lines.push(
        `- [${formatDate(r.created_at)}] Asunto: ${r.subject ?? r.title ?? "-"} | Estado: ${r.status ?? "-"} | Nota: ${String(r.body ?? r.content ?? "-").slice(0, 100)}`
      )
    }
  }

  return lines.length ? lines.join("\n") : "No hay datos disponibles para el período consultado."
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildDatasetStats(
  data: Record<string, any[]>,
  totals?: Partial<Record<TableKey, number>>,
) {
  const lines: string[] = ["RESUMEN ESTADÍSTICO:"]

  const addStatusSummary = (label: string, key: TableKey, rows: any[]) => {
    if (!rows?.length) return
    const statusCount = new Map<string, number>()
    for (const row of rows) {
      const statusKey = String(row?.status ?? row?.action ?? row?.type ?? "SIN_CLASIFICAR").trim().toUpperCase()
      statusCount.set(statusKey, (statusCount.get(statusKey) ?? 0) + 1)
    }
    const top = Array.from(statusCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k}: ${v}`)
      .join(", ")
    const total = Number(totals?.[key] ?? rows.length)
    lines.push(`- ${label}: ${total} registros (${top || "sin desglose"})`)
  }

  addStatusSummary("Supervisiones", "supervisions", data.supervisions ?? [])
  addStatusSummary("Rondas", "round_reports", data.round_reports ?? [])
  addStatusSummary("Incidentes", "incidents", data.incidents ?? [])
  addStatusSummary("Visitantes", "visitors", data.visitors ?? [])
  addStatusSummary("Control de armas", "weapon_control_logs", data.weapon_control_logs ?? [])
  addStatusSummary("Notas internas", "internal_notes", data.internal_notes ?? [])

  return lines.join("\n")
}

export async function POST(request: Request) {
  try {
    let isAuthenticated = false
    let actorEmail: string | null = null

    const sessionClient = await createSessionClient()
    const { data: { user: cookieUser }, error: cookieAuthError } = await sessionClient.auth.getUser()
    if (!cookieAuthError && cookieUser?.id) {
      isAuthenticated = true
      actorEmail = String(cookieUser.email ?? "").trim().toLowerCase() || null
    }

    if (!isAuthenticated) {
      const authHeader = request.headers.get("authorization")
      const bearerToken = authHeader?.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
      if (bearerToken) {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
        if (supabaseUrl && anonKey) {
          const tokenClient = createAdminClient(supabaseUrl, anonKey, {
            auth: { autoRefreshToken: false, persistSession: false },
            global: { headers: { Authorization: `Bearer ${bearerToken}` } },
          })
          const { data: { user: tokenUser }, error: tokenAuthError } = await tokenClient.auth.getUser()
          if (!tokenAuthError && tokenUser?.id) {
            isAuthenticated = true
            actorEmail = String(tokenUser.email ?? "").trim().toLowerCase() || null
          }
        }
      }
    }

    if (!isAuthenticated) return new Response(JSON.stringify({ error: "No autenticado." }), { status: 401 })

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
    if (!supabaseUrl || !serviceRoleKey || !actorEmail) {
      return new Response(JSON.stringify({ error: "Configuración de servidor incompleta." }), { status: 500 })
    }

    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: actorProfile } = await admin
      .from("users")
      .select("role_level,first_name,assigned")
      .ilike("email", actorEmail)
      .limit(1)
      .maybeSingle()
    const actorRoleLevel = Number(actorProfile?.role_level ?? 1)
    if (actorRoleLevel < 2) {
      return new Response(JSON.stringify({ error: "Asistente IA disponible solo para L2/L3/L4." }), { status: 403 })
    }

    const body = (await request.json()) as RequestBody
    const messages = normalizeMessages(Array.isArray(body.messages) ? body.messages : [])
    if (!messages.length) return new Response(JSON.stringify({ error: "Sin mensajes." }), { status: 400 })

    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
    if (!apiKey || apiKey === "TU_OPENAI_API_KEY_AQUI") {
      return new Response(JSON.stringify({ error: "OPENAI_API_KEY no configurada." }), { status: 500 })
    }

    // ── Detectar período y módulos relevantes desde el último mensaje ──────────
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content ?? ""
    const { since, until } = detectDateRange(lastUserMsg)
    const relevantTables = detectRelevantTables(lastUserMsg)
    const deepAnalysis = isDeepAnalysisQuery(lastUserMsg)
    const operationTerm = extractOperationTerm(lastUserMsg)
    const recordsLimit = deepAnalysis ? DEEP_RECORDS_PER_TABLE : BASE_RECORDS_PER_TABLE
    const lineLimitPerTable = deepAnalysis ? 25 : 12

    // ── Consultar solo las tablas necesarias en paralelo ───────────────────────
    const assignedTokens = parseTokens(String(actorProfile?.assigned ?? ""))
    const emailAlias = actorEmail.includes("@") ? actorEmail.split("@")[0] : actorEmail
    const identityTokens = [
      String(actorProfile?.first_name ?? "").trim().toLowerCase(),
      actorEmail.toLowerCase(),
      emailAlias.toLowerCase(),
    ].filter(Boolean)

    const rowMatchesOperation = (row: Record<string, unknown>) => {
      if (!operationTerm) return true
      const text = Object.values(row)
        .map((value) => String(value ?? "").trim().toLowerCase())
        .filter(Boolean)
        .join(" ")
      return text.includes(operationTerm)
    }

    const applyRowFilters = (rows: Record<string, unknown>[]) => {
      const scopedRows = actorRoleLevel >= 3
        ? rows
        : rows.filter((row) => rowMatchesScope(row, assignedTokens, identityTokens))
      return scopedRows.filter(rowMatchesOperation)
    }

    const q = async (table: string, fields: string): Promise<unknown[]> => {
      const fetchLimit = actorRoleLevel >= 3 ? recordsLimit : Math.max(recordsLimit * 3, 200)
      const { data } = await admin.from(table).select(fields).gte("created_at", since).lte("created_at", until).order("created_at", { ascending: false }).limit(fetchLimit)
      const rows = (data ?? []) as unknown as Record<string, unknown>[]
      return applyRowFilters(rows).slice(0, recordsLimit)
    }

    const tableQueries: Record<TableKey, () => Promise<unknown[]>> = {
      supervisions:        () => q("supervisions",        "created_at,officer_name,review_post,operation_name,status,observations"),
      round_reports:       () => q("round_reports",       "created_at,round_name,officer_name,status,checkpoints_completed,checkpoints_total,notes"),
      incidents:           () => q("incidents",           "created_at,type,location,lugar,status,description,details"),
      visitors:            () => q("visitors",            "created_at,name,visitor_name,destination,post,status"),
      weapon_control_logs: () => q("weapon_control_logs", "created_at,weapon_model,weapon_serial,officer_name,action,type"),
      internal_notes:      () => q("internal_notes",      "created_at,subject,title,status,body,content"),
    }

    const countTableRows = async (table: string, fields: string) => {
      const pageSize = 1000
      let from = 0
      let total = 0
      while (true) {
        const { data } = await admin
          .from(table)
          .select(fields)
          .gte("created_at", since)
          .lte("created_at", until)
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1)
        const rows = (data ?? []) as unknown as Record<string, unknown>[]
        if (rows.length === 0) break
        total += applyRowFilters(rows).length
        if (rows.length < pageSize) break
        from += pageSize
      }
      return total
    }

    const countQueries: Record<TableKey, () => Promise<number>> = {
      supervisions:        () => countTableRows("supervisions", "created_at,officer_name,review_post,operation_name,status,observations"),
      round_reports:       () => countTableRows("round_reports", "created_at,round_name,officer_name,status,checkpoints_completed,checkpoints_total,notes"),
      incidents:           () => countTableRows("incidents", "created_at,type,location,lugar,status,description,details"),
      visitors:            () => countTableRows("visitors", "created_at,name,visitor_name,destination,post,status"),
      weapon_control_logs: () => countTableRows("weapon_control_logs", "created_at,weapon_model,weapon_serial,officer_name,action,type"),
      internal_notes:      () => countTableRows("internal_notes", "created_at,subject,title,status,body,content"),
    }

    const results = await Promise.all(
      relevantTables.map(async (key) => ({ key, data: await tableQueries[key]() }))
    )
    const countResults = await Promise.all(
      relevantTables.map(async (key) => ({ key, total: await countQueries[key]() }))
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dataMap: Record<string, any[]> = {}
    for (const { key, data } of results) dataMap[key] = data as any[]
    const totalsMap: Partial<Record<TableKey, number>> = {}
    for (const { key, total } of countResults) totalsMap[key] = total

    const periodLabel = since === until ? formatDate(since) : `${formatDate(since)} — ${formatDate(until)}`
    const statsContext = buildDatasetStats(dataMap, totalsMap)
    const dataContext = buildDataContext(dataMap, lineLimitPerTable)

    const systemPrompt = [
      "Eres un asistente operativo de seguridad privada para HO Seguridad.",
      `Período consultado: ${periodLabel}`,
      `Modo de análisis: ${deepAnalysis ? "PROFUNDO" : "RÁPIDO"}`,
      operationTerm ? `Filtro solicitado por operación: ${operationTerm}` : "",
      actorRoleLevel === 2 ? "IMPORTANTE: estos datos ya están filtrados por permisos L2 (solo alcance asignado y propio)." : "",
      "Responde en español, de forma clara, concisa y profesional.",
      deepAnalysis
        ? "Haz análisis de patrones, riesgos, causas probables y acciones por prioridad (inmediato, 24h, 7 días)."
        : "Si te piden un resumen, sé breve pero completo.",
      "Cuando te pidan cantidades, usa SIEMPRE el RESUMEN ESTADÍSTICO como fuente principal.",
      "Si no hay datos para la pregunta, dilo claramente.",
      "No inventes información.",
      "",
      statsContext,
      "",
      "DATOS DEL SISTEMA:",
      dataContext,
    ].join("\n")

    const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    // ── Streaming ──────────────────────────────────────────────────────────────
    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? (deepAnalysis ? "gpt-4.1" : "gpt-4o"),
        messages: openaiMessages,
        max_tokens: deepAnalysis ? 900 : 650,
        temperature: deepAnalysis ? 0.2 : 0.3,
        stream: true,
      }),
    })

    if (!aiResponse.ok || !aiResponse.body) {
      const raw = await aiResponse.text()
      if (aiResponse.status === 401 || raw.toLowerCase().includes("invalid_api_key")) {
        return new Response(JSON.stringify({ error: "OPENAI_API_KEY inválida." }), { status: 502 })
      }
      return new Response(JSON.stringify({ error: `Error IA (${aiResponse.status}).` }), { status: 502 })
    }

    // Pasar el stream de OpenAI directamente al cliente
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const reader = aiResponse.body!.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            const chunk = decoder.decode(value, { stream: true })
            const lines = chunk.split("\n").filter((l) => l.startsWith("data: ") && l !== "data: [DONE]")
            for (const line of lines) {
              try {
                const json = JSON.parse(line.slice(6)) as { choices?: Array<{ delta?: { content?: string } }> }
                const token = json.choices?.[0]?.delta?.content ?? ""
                if (token) controller.enqueue(encoder.encode(token))
              } catch { /* skip malformed chunks */ }
            }
          }
        } finally {
          controller.close()
          reader.releaseLock()
        }
      },
    })

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Transfer-Encoding": "chunked",
        "Cache-Control": "no-cache",
      },
    })
  } catch {
    return new Response(JSON.stringify({ error: "Error inesperado en el asistente IA." }), { status: 500 })
  }
}
