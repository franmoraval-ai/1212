import { NextResponse } from "next/server"
import { getOpenAITimeoutSignal, getOpenAIUrl } from "@/lib/openai-server"
import { getAuthenticatedActor, isManager } from "@/lib/server-auth"

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
    const { actor, error, status } = await getAuthenticatedActor(request)
    if (!actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    if (!isManager(actor)) {
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

    const aiResponse = await fetch(getOpenAIUrl("/responses"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: getOpenAITimeoutSignal(30000),
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
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      return NextResponse.json({ error: "La IA tardó demasiado en responder." }, { status: 504 })
    }
    return NextResponse.json({ error: "Error inesperado generando resumen IA." }, { status: 500 })
  }
}
