import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"

export async function POST(request: Request) {
  try {
    const { admin, actor, error, status } = await getAuthenticatedActor(request)
    if (!admin || !actor) {
      return NextResponse.json({ error: error ?? "No autenticado." }, { status })
    }

    const targetEmail = String(actor.email ?? "").trim().toLowerCase()

    if (!targetEmail) {
      return NextResponse.json({ error: "No se pudo determinar el usuario de presencia offline." }, { status: 400 })
    }

    await admin
      .from("users")
      .update({ is_online: false, last_seen: new Date().toISOString() })
      .eq("email", targetEmail)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "No se pudo registrar presencia offline." }, { status: 500 })
  }
}
