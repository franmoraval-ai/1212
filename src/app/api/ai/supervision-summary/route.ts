import { NextResponse } from "next/server"
import { getOpenAITimeoutSignal, getOpenAIUrl } from "@/lib/openai-server"
import { getAuthenticatedActor, isManager } from "@/lib/server-auth"

type SupervisionSummaryPayload = {
  reportCode?: string
  date?: string
  hour?: string
  operationName?: string
  officerName?: string
  reviewPost?: string
  type?: string
  idNumber?: string
  weaponModel?: string
  weaponSerial?: string
  lugar?: string
  status?: string
  checklist?: {
    uniform?: boolean
    equipment?: boolean
    punctuality?: boolean
    service?: boolean
  }
  checklistReasons?: {
    uniform?: string
    equipment?: string
    punctuality?: string
    service?: string
  }
  propertyDetails?: {
    luz?: string
    perimetro?: string
    sacate?: string
    danosPropiedad?: string
  }
  observations?: string
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

function normalizeBody(body: unknown): SupervisionSummaryPayload {
  if (!body || typeof body !== "object") return {}
  const raw = body as Record<string, unknown>
  const checklist = raw.checklist && typeof raw.checklist === "object" ? (raw.checklist as Record<string, unknown>) : {}
  const checklistReasons = raw.checklistReasons && typeof raw.checklistReasons === "object" ? (raw.checklistReasons as Record<string, unknown>) : {}
  const propertyDetails = raw.propertyDetails && typeof raw.propertyDetails === "object" ? (raw.propertyDetails as Record<string, unknown>) : {}
  return {
    reportCode: String(raw.reportCode ?? "").trim(),
    date: String(raw.date ?? "").trim(),
    hour: String(raw.hour ?? "").trim(),
    operationName: String(raw.operationName ?? "").trim(),
    officerName: String(raw.officerName ?? "").trim(),
    reviewPost: String(raw.reviewPost ?? "").trim(),
    type: String(raw.type ?? "").trim(),
    idNumber: String(raw.idNumber ?? "").trim(),
    weaponModel: String(raw.weaponModel ?? "").trim(),
    weaponSerial: String(raw.weaponSerial ?? "").trim(),
    lugar: String(raw.lugar ?? "").trim(),
    status: String(raw.status ?? "").trim(),
    checklist: {
      uniform: Boolean(checklist.uniform),
      equipment: Boolean(checklist.equipment),
      punctuality: Boolean(checklist.punctuality),
      service: Boolean(checklist.service),
    },
    checklistReasons: {
      uniform: String(checklistReasons.uniform ?? "").trim(),
      equipment: String(checklistReasons.equipment ?? "").trim(),
      punctuality: String(checklistReasons.punctuality ?? "").trim(),
      service: String(checklistReasons.service ?? "").trim(),
    },
    propertyDetails: {
      luz: String(propertyDetails.luz ?? "").trim(),
      perimetro: String(propertyDetails.perimetro ?? "").trim(),
      sacate: String(propertyDetails.sacate ?? "").trim(),
      danosPropiedad: String(propertyDetails.danosPropiedad ?? "").trim(),
    },
    observations: String(raw.observations ?? "").trim(),
  }
}

function bool(v?: boolean) {
  return v ? "OK" : "NO CUMPLE"
}

function buildPrompt(data: SupervisionSummaryPayload) {
  const cl = data.checklist ?? {}
  const clr = data.checklistReasons ?? {}
  const prop = data.propertyDetails ?? {}

  const checklistLines = [
    `- Uniforme: ${bool(cl.uniform)}${clr.uniform ? ` (${clr.uniform})` : ""}`,
    `- Equipo: ${bool(cl.equipment)}${clr.equipment ? ` (${clr.equipment})` : ""}`,
    `- Puntualidad: ${bool(cl.punctuality)}${clr.punctuality ? ` (${clr.punctuality})` : ""}`,
    `- Servicio: ${bool(cl.service)}${clr.service ? ` (${clr.service})` : ""}`,
  ].join("\n")

  const propertyLines = [
    prop.luz ? `- Luz: ${prop.luz}` : null,
    prop.perimetro ? `- Perimetro: ${prop.perimetro}` : null,
    prop.sacate ? `- Sacate/Veg.: ${prop.sacate}` : null,
    prop.danosPropiedad ? `- Daños: ${prop.danosPropiedad}` : null,
  ].filter(Boolean).join("\n") || "- Sin datos de propiedad"

  return [
    "Eres analista operativo de seguridad privada. Resume una boleta de supervisión en español claro y accionable.",
    "Responde SOLO en este formato:",
    "1) Resumen ejecutivo (max 4 lineas)",
    "2) Hallazgos y novedades (max 4 bullets)",
    "3) Acciones recomendadas (max 4 bullets)",
    "4) Nivel de prioridad: BAJA, MEDIA o ALTA",
    "No inventes datos. Si algo falta, dilo de forma breve.",
    "",
    "DATOS BOLETA:",
    `Codigo: ${data.reportCode || "-"}`,
    `Fecha: ${data.date || "-"}`,
    `Hora: ${data.hour || "-"}`,
    `Operacion: ${data.operationName || "-"}`,
    `Oficial supervisado: ${data.officerName || "-"}`,
    `Cedula: ${data.idNumber || "-"}`,
    `Puesto: ${data.reviewPost || "-"}`,
    `Lugar: ${data.lugar || "-"}`,
    `Tipo supervision: ${data.type || "-"}`,
    `Arma: ${data.weaponModel || "-"} / Serie: ${data.weaponSerial || "-"}`,
    `Estado: ${data.status || "-"}`,
    "Checklist:",
    checklistLines,
    "Condicion de propiedad:",
    propertyLines,
    `Observaciones: ${data.observations || "-"}`,
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

    if (!body.operationName && !body.reportCode) {
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
