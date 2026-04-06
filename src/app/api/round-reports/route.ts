import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

const ROUND_REPORT_COMPAT_COLUMNS = ["supervisor_name", "supervisor_id"] as const

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function hasCompatColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return ROUND_REPORT_COMPAT_COLUMNS.some((column) => normalized.includes(column))
}

function stripCompatColumns<TRecord extends Record<string, unknown>>(row: TRecord) {
  const next = { ...row }
  for (const column of ROUND_REPORT_COMPAT_COLUMNS) {
    delete next[column]
  }
  return next
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const row: Record<string, unknown> = {
      ...body,
      officer_id: actor.uid,
    }

    if (!normalizeText(row.round_name) || !normalizeText(row.post_name)) {
      return NextResponse.json({ error: "Nombre de ronda y puesto son obligatorios." }, { status: 400 })
    }

    let { error: insertError } = await admin.from("round_reports").insert(row)
    let warning: string | null = null

    if (insertError && hasCompatColumnError(insertError.message)) {
      const fallback = await admin.from("round_reports").insert(stripCompatColumns(row))
      insertError = fallback.error
      if (!insertError) {
        warning = "La boleta se guardó sin supervisor_name/supervisor_id porque esas columnas aún no existen en la base."
      }
    }

    if (insertError) {
      return NextResponse.json({ error: String(insertError.message ?? "No se pudo guardar la boleta.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true, warning })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando boleta." }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar boletas de ronda." }, { status: 403 })
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

    let { error: updateError } = await admin.from("round_reports").update(payload).eq("id", id)
    let warning: string | null = null

    if (updateError && hasCompatColumnError(updateError.message)) {
      const fallback = await admin.from("round_reports").update(stripCompatColumns(payload)).eq("id", id)
      updateError = fallback.error
      if (!updateError) {
        warning = "La boleta se actualizó sin supervisor_name/supervisor_id porque esas columnas aún no existen en la base."
      }
    }

    if (updateError) {
      return NextResponse.json({ error: String(updateError.message ?? "No se pudo actualizar la boleta.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true, warning })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando boleta." }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo L4 puede administrar boletas de ronda." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = normalizeText(body.id)
    if (!id) {
      return NextResponse.json({ error: "Falta id." }, { status: 400 })
    }

    const { error: deleteError } = await admin.from("round_reports").delete().eq("id", id)
    if (deleteError) {
      return NextResponse.json({ error: String(deleteError.message ?? "No se pudo eliminar la boleta.") }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado eliminando boleta." }, { status: 500 })
  }
}