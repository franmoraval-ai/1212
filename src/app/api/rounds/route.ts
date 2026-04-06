import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!normalizeText(body.name) || !normalizeText(body.post)) {
      return NextResponse.json({ error: "Nombre de ronda y puesto son obligatorios." }, { status: 400 })
    }

    const { error: insertError } = await admin.from("rounds").insert(body)
    if (insertError) {
      const message = String(insertError.message ?? "No se pudo crear la ronda.")
      const errorStatus = message.toLowerCase().includes("duplicate") ? 409 : 500
      return NextResponse.json({ error: message }, { status: errorStatus })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado creando ronda." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const payload = { ...body }
    delete payload.id
    if (Object.keys(payload).length === 0) {
      return NextResponse.json({ error: "No hay cambios para aplicar." }, { status: 400 })
    }

    const { error: updateError } = await admin.from("rounds").update(payload).eq("id", id)
    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar la ronda.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando ronda." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar definiciones de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("rounds").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar la ronda.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando ronda." }, { status: 500 })
  }
}