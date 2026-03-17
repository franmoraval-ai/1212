import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

const DAYS_CONTEXT = 30 // cuántos días atrás buscar por defecto
const MAX_RECORDS_PER_TABLE = 40

type Message = { role: "user" | "assistant"; content: string }

type RequestBody = {
  messages?: unknown[]
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
function buildDataContext(data: Record<string, any[]>) {
  const lines: string[] = []

  if (data.supervisions?.length) {
    lines.push(`\n## SUPERVISIONES (${data.supervisions.length} registros)`)
    for (const r of data.supervisions) {
      lines.push(
        `- [${formatDate(r.created_at)}] Oficial: ${r.officer_name ?? "-"} | Puesto: ${r.review_post ?? "-"} | Op: ${r.operation_name ?? "-"} | Estado: ${r.status ?? "-"} | Obs: ${r.observations ?? "-"}`
      )
    }
  }

  if (data.round_reports?.length) {
    lines.push(`\n## RONDAS (${data.round_reports.length} registros)`)
    for (const r of data.round_reports) {
      lines.push(
        `- [${formatDate(r.created_at)}] Ronda: ${r.round_name ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Estado: ${r.status ?? "-"} | Avance: ${r.checkpoints_completed ?? 0}/${r.checkpoints_total ?? 0} | Notas: ${r.notes ?? "-"}`
      )
    }
  }

  if (data.incidents?.length) {
    lines.push(`\n## INCIDENTES (${data.incidents.length} registros)`)
    for (const r of data.incidents) {
      lines.push(
        `- [${formatDate(r.created_at)}] Tipo: ${r.type ?? "-"} | Lugar: ${r.location ?? r.lugar ?? "-"} | Estado: ${r.status ?? "-"} | Desc: ${String(r.description ?? r.details ?? "-").slice(0, 120)}`
      )
    }
  }

  if (data.visitors?.length) {
    lines.push(`\n## VISITANTES (${data.visitors.length} registros)`)
    for (const r of data.visitors) {
      lines.push(
        `- [${formatDate(r.created_at)}] Nombre: ${r.name ?? r.visitor_name ?? "-"} | Destino: ${r.destination ?? r.post ?? "-"} | Estado: ${r.status ?? "-"}`
      )
    }
  }

  if (data.weapon_control_logs?.length) {
    lines.push(`\n## CONTROL DE ARMAS (${data.weapon_control_logs.length} registros)`)
    for (const r of data.weapon_control_logs) {
      lines.push(
        `- [${formatDate(r.created_at)}] Arma: ${r.weapon_model ?? "-"} | Serie: ${r.weapon_serial ?? "-"} | Oficial: ${r.officer_name ?? "-"} | Accion: ${r.action ?? r.type ?? "-"}`
      )
    }
  }

  if (data.internal_notes?.length) {
    lines.push(`\n## NOTAS INTERNAS (${data.internal_notes.length} registros)`)
    for (const r of data.internal_notes) {
      lines.push(
        `- [${formatDate(r.created_at)}] Asunto: ${r.subject ?? r.title ?? "-"} | Estado: ${r.status ?? "-"} | Nota: ${String(r.body ?? r.content ?? "-").slice(0, 100)}`
      )
    }
  }

  return lines.length ? lines.join("\n") : "No hay datos disponibles para el período consultado."
}

export async function POST(request: Request) {
  try {
    let isAuthenticated = false
    let actorEmail: string | null = null

    const sessionClient = await createSessionClient()
    const {
      data: { user: cookieUser },
      error: cookieAuthError,
    } = await sessionClient.auth.getUser()

    if (!cookieAuthError && cookieUser?.id) {
      isAuthenticated = true
      actorEmail = String(cookieUser.email ?? "").trim().toLowerCase() || null
    }

    if (!isAuthenticated) {
      const authHeader = request.headers.get("authorization")
      const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
        ? authHeader.slice(7).trim()
        : ""

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

    if (!isAuthenticated) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

    if (!supabaseUrl || !serviceRoleKey || !actorEmail) {
      return NextResponse.json({ error: "Configuración de servidor incompleta." }, { status: 500 })
    }

    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: actorProfile, error: profileError } = await admin
      .from("users")
      .select("role_level")
      .ilike("email", actorEmail)
      .limit(1)
      .maybeSingle()

    if (profileError || Number(actorProfile?.role_level ?? 1) < 3) {
      return NextResponse.json({ error: "Asistente IA disponible solo para L3/L4." }, { status: 403 })
    }

    const body = (await request.json()) as RequestBody
    const messages = normalizeMessages(Array.isArray(body.messages) ? body.messages : [])

    if (!messages.length) {
      return NextResponse.json({ error: "Sin mensajes." }, { status: 400 })
    }

    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
    if (!apiKey || apiKey === "TU_OPENAI_API_KEY_AQUI") {
      return NextResponse.json({ error: "OPENAI_API_KEY no configurada." }, { status: 500 })
    }

    // Consultar datos de los últimos DAYS_CONTEXT días
    const since = new Date(Date.now() - DAYS_CONTEXT * 24 * 60 * 60 * 1000).toISOString()

    const [supervisions, round_reports, incidents, visitors, weapon_control_logs, internal_notes] =
      await Promise.all([
        admin.from("supervisions").select("created_at,officer_name,review_post,operation_name,status,observations").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
        admin.from("round_reports").select("created_at,round_name,officer_name,status,checkpoints_completed,checkpoints_total,notes").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
        admin.from("incidents").select("created_at,type,location,lugar,status,description,details").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
        admin.from("visitors").select("created_at,name,visitor_name,destination,post,status").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
        admin.from("weapon_control_logs").select("created_at,weapon_model,weapon_serial,officer_name,action,type").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
        admin.from("internal_notes").select("created_at,subject,title,status,body,content").gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_RECORDS_PER_TABLE),
      ])

    const dataContext = buildDataContext({
      supervisions: supervisions.data ?? [],
      round_reports: round_reports.data ?? [],
      incidents: incidents.data ?? [],
      visitors: visitors.data ?? [],
      weapon_control_logs: weapon_control_logs.data ?? [],
      internal_notes: internal_notes.data ?? [],
    })

    const systemPrompt = [
      "Eres un asistente operativo de seguridad privada para HO Seguridad.",
      "Tienes acceso a los datos del sistema de los últimos 30 días.",
      "Responde en español, de forma clara, concisa y profesional.",
      "Si te piden un resumen, sé breve pero completo.",
      "Si no encuentras datos relevantes para la pregunta, dilo claramente.",
      "No inventes información que no esté en los datos.",
      "",
      "DATOS DEL SISTEMA (últimos 30 días):",
      dataContext,
    ].join("\n")

    const openaiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...messages.map((m) => ({ role: m.role, content: m.content })),
    ]

    const aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        messages: openaiMessages,
        max_tokens: 600,
        temperature: 0.3,
      }),
    })

    if (!aiResponse.ok) {
      const raw = await aiResponse.text()
      const normalized = raw.toLowerCase()
      if (aiResponse.status === 401 || normalized.includes("invalid_api_key")) {
        return NextResponse.json({ error: "OPENAI_API_KEY inválida." }, { status: 502 })
      }
      return NextResponse.json({ error: `Error IA (${aiResponse.status}).` }, { status: 502 })
    }

    const aiData = (await aiResponse.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const reply = String(aiData.choices?.[0]?.message?.content ?? "").trim()

    if (!reply) {
      return NextResponse.json({ error: "La IA no devolvió respuesta." }, { status: 502 })
    }

    return NextResponse.json({ ok: true, reply })
  } catch {
    return NextResponse.json({ error: "Error inesperado en el asistente IA." }, { status: 500 })
  }
}
