import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { normalizePushSubscription } from "@/lib/push-subscription"

export const dynamic = "force-dynamic"

type SubscribeBody = {
  subscription?: unknown
  userAgent?: unknown
}

type UnsubscribeBody = {
  endpoint?: unknown
}

function isMissingColumnError(message: string | null | undefined): boolean {
  const text = String(message ?? "").toLowerCase()
  return text.includes("column") && (text.includes("does not exist") || text.includes("schema cache"))
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error }, { status })
  }

  let body: SubscribeBody
  try {
    body = (await request.json()) as SubscribeBody
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 })
  }

  const normalized = normalizePushSubscription(body.subscription)
  if (!normalized) {
    return NextResponse.json({ error: "Suscripción push inválida." }, { status: 400 })
  }

  const now = new Date().toISOString()
  const fullRow = {
    user_id: actor.userId,
    user_email: actor.email,
    endpoint: normalized.endpoint,
    p256dh: normalized.p256dh,
    auth: normalized.auth,
    user_agent: typeof body.userAgent === "string" ? body.userAgent.slice(0, 400) : null,
    active: true,
    updated_at: now,
  }

  let upsertError = await admin
    .from("push_subscriptions")
    .upsert(fullRow, { onConflict: "user_id,endpoint" })
    .then((result) => result.error)

  // Schema-compat: si faltan columnas opcionales (user_agent/updated_at) en un
  // entorno con esquema viejo, reintenta con el conjunto mínimo.
  if (upsertError && isMissingColumnError(upsertError.message)) {
    const minimalRow = {
      user_id: actor.userId,
      user_email: actor.email,
      endpoint: normalized.endpoint,
      p256dh: normalized.p256dh,
      auth: normalized.auth,
      active: true,
    }
    upsertError = await admin
      .from("push_subscriptions")
      .upsert(minimalRow, { onConflict: "user_id,endpoint" })
      .then((result) => result.error)
  }

  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error }, { status })
  }

  let body: UnsubscribeBody
  try {
    body = (await request.json()) as UnsubscribeBody
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 })
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : ""
  if (!endpoint) {
    return NextResponse.json({ error: "Falta el endpoint." }, { status: 400 })
  }

  const { error: deleteError } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", actor.userId)
    .eq("endpoint", endpoint)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
