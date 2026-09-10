import { NextResponse } from "next/server"
import { getAdminClient } from "@/lib/server-auth"
import { hasValidWhatsappBotSecret } from "@/lib/whatsapp-bot-auth"

const CLAIM_LIMIT = 20

// Bot polls this to claim pending outbound messages (supervisor/manager WhatsApp alerts).
export async function GET(request: Request) {
  if (!hasValidWhatsappBotSecret(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 })
  }

  const { admin, error: adminError } = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: adminError ?? "Servicio no disponible." }, { status: 500 })
  }

  const { data: pendingRows, error: pendingError } = await admin
    .from("whatsapp_outbound_messages")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(CLAIM_LIMIT)

  if (pendingError) {
    return NextResponse.json({ error: pendingError.message }, { status: 500 })
  }

  const ids = ((pendingRows ?? []) as { id: string }[]).map((row) => row.id)
  if (ids.length === 0) {
    return NextResponse.json({ messages: [] })
  }

  const { data: claimed, error: claimError } = await admin
    .from("whatsapp_outbound_messages")
    .update({ status: "claimed", claimed_at: new Date().toISOString() })
    .in("id", ids)
    .eq("status", "pending")
    .select("id,to_phone,message,context")

  if (claimError) {
    return NextResponse.json({ error: claimError.message }, { status: 500 })
  }

  return NextResponse.json({ messages: claimed ?? [] })
}

type AckBody = {
  id?: unknown
  status?: unknown
  error?: unknown
}

// Bot reports delivery result back here after attempting to send each claimed message.
export async function POST(request: Request) {
  if (!hasValidWhatsappBotSecret(request)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 })
  }

  const { admin, error: adminError } = getAdminClient()
  if (!admin) {
    return NextResponse.json({ error: adminError ?? "Servicio no disponible." }, { status: 500 })
  }

  let body: AckBody
  try {
    body = (await request.json()) as AckBody
  } catch {
    return NextResponse.json({ error: "Cuerpo invalido." }, { status: 400 })
  }

  const id = String(body.id ?? "").trim()
  const delivered = body.status === "sent"
  if (!id) {
    return NextResponse.json({ error: "Falta id." }, { status: 400 })
  }

  const { error: updateError } = await admin
    .from("whatsapp_outbound_messages")
    .update({
      status: delivered ? "sent" : "failed",
      sent_at: delivered ? new Date().toISOString() : null,
      last_error: delivered ? null : String(body.error ?? "").trim() || "unknown",
    })
    .eq("id", id)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
