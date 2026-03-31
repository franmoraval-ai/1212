import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector } from "@/lib/server-auth"
import { ensureUniqueShiftNfcCode, hashShiftPin, normalizeShiftNfcCode } from "@/lib/shift-credentials"

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede actualizar credenciales de relevo." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      userId?: string
      shiftPin?: string
      shiftNfcCode?: string
    }

    const userId = String(body.userId ?? "").trim()
    const shiftPin = String(body.shiftPin ?? "").replace(/\D/g, "")
    const shiftNfcCode = normalizeShiftNfcCode(body.shiftNfcCode)

    if (!userId) {
      return NextResponse.json({ error: "Falta userId." }, { status: 400 })
    }

    if (shiftPin && (shiftPin.length < 4 || shiftPin.length > 8)) {
      return NextResponse.json({ error: "El PIN de relevo debe tener entre 4 y 8 dígitos." }, { status: 400 })
    }

    const nfcValidation = await ensureUniqueShiftNfcCode(admin, shiftNfcCode, userId)
    if (!nfcValidation.ok) {
      return NextResponse.json({ error: nfcValidation.error }, { status: nfcValidation.status })
    }

    const { error: updateError } = await admin
      .from("users")
      .update({
        shift_pin_hash: shiftPin ? hashShiftPin(shiftPin) : null,
        shift_nfc_code: shiftNfcCode || null,
      })
      .eq("id", userId)

    if (updateError) {
      const message = String(updateError.message ?? "")
      if (message.toLowerCase().includes("shift_pin_hash") || message.toLowerCase().includes("shift_nfc_code")) {
        return NextResponse.json({ error: "Ejecute supabase/add_station_shift_mode.sql antes de configurar credenciales de relevo." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudieron guardar las credenciales de relevo." }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: "Error inesperado actualizando credenciales." }, { status: 500 })
  }
}