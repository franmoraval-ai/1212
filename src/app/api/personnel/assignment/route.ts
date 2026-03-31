import { NextResponse } from "next/server"
import { buildAssignedScope, validateL1Assignment } from "@/lib/personnel-assignment"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede reasignar puestos L1." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      userId?: string
      operationName?: string
      postName?: string
    }

    const userId = String(body.userId ?? "").trim()
    const operationName = String(body.operationName ?? "").trim()
    const postName = String(body.postName ?? "").trim()

    if (!userId) {
      return NextResponse.json({ error: "Falta userId." }, { status: 400 })
    }

    const assigned = buildAssignedScope(operationName, postName)
    const validation = await validateL1Assignment(admin, assigned)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }

    const { data: targetUser, error: userError } = await admin
      .from("users")
      .select("id,role_level")
      .eq("id", userId)
      .maybeSingle()

    if (userError) {
      return NextResponse.json({ error: "No se pudo validar el usuario objetivo." }, { status: 500 })
    }

    if (!targetUser?.id) {
      return NextResponse.json({ error: "Usuario no encontrado." }, { status: 404 })
    }

    if (Number(targetUser.role_level ?? 1) !== 1) {
      return NextResponse.json({ error: "La reasignación estructurada aplica solo a oficiales L1." }, { status: 400 })
    }

    const { error: updateError } = await admin
      .from("users")
      .update({ assigned })
      .eq("id", userId)

    if (updateError) {
      return NextResponse.json({ error: "No se pudo actualizar la asignación del oficial." }, { status: 500 })
    }

    return NextResponse.json({ ok: true, assigned })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando asignación." }, { status: 500 })
  }
}