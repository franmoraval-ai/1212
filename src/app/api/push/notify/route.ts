import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { loadManagedTeamScope } from "@/lib/manager-hierarchy"
import { canAlertOfficer } from "@/lib/push-authorization"
import { isPushConfigured, sendPushToUserIds } from "@/lib/push-server"

export const dynamic = "force-dynamic"

type NotifyBody = {
  targetOfficerId?: unknown
  title?: unknown
  body?: unknown
  url?: unknown
}

function asTrimmed(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error }, { status })
  }

  if (Number(actor.roleLevel ?? 1) < 2) {
    return NextResponse.json({ error: "No autorizado para enviar alertas." }, { status: 403 })
  }

  if (!isPushConfigured()) {
    return NextResponse.json({ error: "Notificaciones push no configuradas en el servidor." }, { status: 503 })
  }

  let payload: NotifyBody
  try {
    payload = (await request.json()) as NotifyBody
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido." }, { status: 400 })
  }

  const targetOfficerId = asTrimmed(payload.targetOfficerId)
  const title = asTrimmed(payload.title) || "Alerta de tu supervisor"
  const message = asTrimmed(payload.body)
  if (!targetOfficerId) {
    return NextResponse.json({ error: "Falta el oficial destino." }, { status: 400 })
  }
  if (!message) {
    return NextResponse.json({ error: "El mensaje no puede estar vacío." }, { status: 400 })
  }

  const { data: target, error: targetError } = await admin
    .from("users")
    .select("id, email, assigned")
    .eq("id", targetOfficerId)
    .maybeSingle()

  if (targetError) {
    return NextResponse.json({ error: "No se pudo validar el oficial destino." }, { status: 500 })
  }
  if (!target) {
    return NextResponse.json({ error: "Oficial no encontrado." }, { status: 404 })
  }

  const { scope: managedTeamScope } = await loadManagedTeamScope(admin, actor)
  const authorized = canAlertOfficer(actor, managedTeamScope, {
    id: String(target.id ?? ""),
    email: String(target.email ?? ""),
    assigned: (target.assigned as string | null | undefined) ?? null,
  })
  if (!authorized) {
    return NextResponse.json({ error: "El oficial está fuera de tu ámbito." }, { status: 403 })
  }

  const result = await sendPushToUserIds(admin, [targetOfficerId], {
    title: title.slice(0, 120),
    body: message.slice(0, 400),
    url: asTrimmed(payload.url) || "/overview",
    tag: `supervisor-alert-${targetOfficerId}`,
  })

  return NextResponse.json({ ok: true, ...result })
}
