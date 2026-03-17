import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

type RoundSummaryPayload = {
  reportCode?: string
  date?: string
  hour?: string
  roundName?: string
  postName?: string
  officerName?: string
  supervisorName?: string
  status?: string
  progress?: string
  preRoundCondition?: string
  distanceKm?: string
  duration?: string
  evidenceCount?: number
  alerts?: string[]
  notes?: string
}

type OpenAIResponsesSuccess = {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

function extractTextFromOpenAIResponse(data: OpenAIResponsesSuccess) {
  const outputText = String(data?.output_text ?? "").trim()
  if (outputText) return outputText

  const chunks = (data?.output ?? [])
    .flatMap((item) => item?.content ?? [])
    .map((content) => String(content?.text ?? "").trim())
    .filter(Boolean)

  return chunks.join("\n").trim()
}

function normalizeBody(body: unknown): RoundSummaryPayload {
  if (!body || typeof body !== "object") return {}
  const raw = body as Record<string, unknown>
  return {
    reportCode: String(raw.reportCode ?? "").trim(),
    date: String(raw.date ?? "").trim(),
    hour: String(raw.hour ?? "").trim(),
    roundName: String(raw.roundName ?? "").trim(),
    postName: String(raw.postName ?? "").trim(),
    officerName: String(raw.officerName ?? "").trim(),
    supervisorName: String(raw.supervisorName ?? "").trim(),
    status: String(raw.status ?? "").trim(),
    progress: String(raw.progress ?? "").trim(),
    preRoundCondition: String(raw.preRoundCondition ?? "").trim(),
    distanceKm: String(raw.distanceKm ?? "").trim(),
    duration: String(raw.duration ?? "").trim(),
    evidenceCount: Number.isFinite(Number(raw.evidenceCount)) ? Number(raw.evidenceCount) : 0,
    alerts: Array.isArray(raw.alerts) ? raw.alerts.map((a) => String(a)).filter(Boolean).slice(0, 10) : [],
    notes: String(raw.notes ?? "").trim(),
  }
}

function buildPrompt(data: RoundSummaryPayload) {
  const alerts = (data.alerts ?? []).length > 0 ? (data.alerts ?? []).map((a) => `- ${a}`).join("\n") : "- Sin alertas"

  return [
    "Eres analista operativo de seguridad privada. Resume una boleta de ronda en español claro y accionable.",
    "Responde SOLO en este formato:",
    "1) Resumen ejecutivo (max 4 lineas)",
    "2) Riesgos detectados (max 4 bullets)",
    "3) Acciones recomendadas (max 4 bullets)",
    "4) Nivel de prioridad: BAJA, MEDIA o ALTA",
    "No inventes datos. Si algo falta, dilo de forma breve.",
    "",
    "DATOS BOLETA:",
    `Codigo: ${data.reportCode || "-"}`,
    `Fecha: ${data.date || "-"}`,
    `Hora: ${data.hour || "-"}`,
    `Ronda: ${data.roundName || "-"}`,
    `Lugar: ${data.postName || "-"}`,
    `Oficial: ${data.officerName || "-"}`,
    `Supervisor: ${data.supervisorName || "-"}`,
    `Estado: ${data.status || "-"}`,
    `Avance: ${data.progress || "-"}`,
    `Pre-ronda: ${data.preRoundCondition || "-"}`,
    `Distancia (km): ${data.distanceKm || "-"}`,
    `Duracion: ${data.duration || "-"}`,
    `Evidencias: ${String(data.evidenceCount ?? 0)}`,
    "Alertas:",
    alerts,
    `Observaciones: ${data.notes || "-"}`,
  ].join("\n")
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

        if (!supabaseUrl || !anonKey) {
          return NextResponse.json({ error: "Falta configurar Supabase en el servidor." }, { status: 500 })
        }

        const tokenClient = createAdminClient(supabaseUrl, anonKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        })

        const {
          data: { user: tokenUser },
          error: tokenAuthError,
        } = await tokenClient.auth.getUser()

        if (!tokenAuthError && tokenUser?.id) {
          isAuthenticated = true
          actorEmail = String(tokenUser.email ?? "").trim().toLowerCase() || null
        }
      }
    }

    if (!isAuthenticated) {
      return NextResponse.json({ error: "No autenticado." }, { status: 401 })
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ error: "Falta configurar credenciales de servidor Supabase." }, { status: 500 })
    }

    if (!actorEmail) {
      return NextResponse.json({ error: "No se pudo validar perfil del usuario." }, { status: 401 })
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

    if (profileError) {
      return NextResponse.json({ error: "No se pudo validar permisos de IA." }, { status: 500 })
    }

    if (Number(actorProfile?.role_level ?? 1) < 3) {
      return NextResponse.json({ error: "IA disponible solo para L3/L4." }, { status: 403 })
    }

    const body = normalizeBody(await request.json())

    if (!body.roundName && !body.reportCode) {
      return NextResponse.json({ error: "Datos insuficientes para resumir boleta." }, { status: 400 })
    }

    const apiKey = String(process.env.OPENAI_API_KEY ?? "").trim()
    if (!apiKey || apiKey === "TU_OPENAI_API_KEY_AQUI") {
      return NextResponse.json({ error: "OPENAI_API_KEY no configurada correctamente en el servidor." }, { status: 500 })
    }

    const model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
    const prompt = buildPrompt(body)

    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        max_output_tokens: 450,
      }),
    })

    if (!aiResponse.ok) {
      const status = aiResponse.status
      const raw = await aiResponse.text()
      const normalized = raw.toLowerCase()

      if (status === 401 || normalized.includes("invalid_api_key") || normalized.includes("incorrect api key")) {
        return NextResponse.json({ error: "Error IA: OPENAI_API_KEY inválida en servidor." }, { status: 502 })
      }

      return NextResponse.json({ error: `Error IA (${status}).` }, { status: 502 })
    }

    const aiData = (await aiResponse.json()) as OpenAIResponsesSuccess
    const summary = extractTextFromOpenAIResponse(aiData)

    if (!summary) {
      return NextResponse.json({ error: "La IA no devolvió contenido." }, { status: 502 })
    }

    return NextResponse.json({ ok: true, summary })
  } catch {
    return NextResponse.json({ error: "Error inesperado generando resumen IA." }, { status: 500 })
  }
}
