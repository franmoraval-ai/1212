import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    const body = (await request.json().catch(() => ({}))) as { online?: boolean }
    const online = body.online !== false

    const { error: updateError } = await admin
      .from("users")
      .update({ is_online: online, last_seen: new Date().toISOString() })
      .eq("email", actor.email)

    if (updateError) {
      return NextResponse.json({ error: "No se pudo actualizar presencia." }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando presencia." }, { status: 500 })
  }
}