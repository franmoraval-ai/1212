import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { stationMatchesAssigned } from "@/lib/stations"

type WeaponRow = {
  id: string
  serial?: string | null
  model?: string | null
  status?: string | null
  assigned_to?: string | null
  ammo_count?: number | null
}

function hasAmmoColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("ammo_count") || normalized.includes("ammocount")
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ ok: false, error: error ?? "No autenticado." }, { status })
  }

  if (actor.roleLevel < 2) {
    return NextResponse.json({ ok: false, error: "Solo L2-L4 pueden aplicar control de armas." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      weaponId?: string
      targetPost?: string
      ammoCount?: number
      reason?: string
    }

    const weaponId = String(body.weaponId ?? "").trim()
    const targetPost = String(body.targetPost ?? "").trim()
    const ammoCount = Math.trunc(Number(body.ammoCount ?? 0))
    const reasonRaw = String(body.reason ?? "cambio").trim().toLowerCase()
    const reason = reasonRaw === "dano" || reasonRaw === "traslado" ? reasonRaw : "cambio"

    if (!weaponId || !targetPost) {
      return NextResponse.json({ ok: false, error: "Arma y puesto objetivo son obligatorios." }, { status: 400 })
    }

    if (!Number.isFinite(ammoCount) || ammoCount < 0) {
      return NextResponse.json({ ok: false, error: "ammoCount debe ser un número mayor o igual a 0." }, { status: 400 })
    }

    if (actor.roleLevel === 2) {
      const assigned = String(actor.assigned ?? "").trim()
      if (!assigned) {
        return NextResponse.json({ ok: false, error: "El supervisor L2 no tiene un alcance asignado para controlar armas." }, { status: 403 })
      }

      if (!stationMatchesAssigned(targetPost, assigned)) {
        return NextResponse.json({ ok: false, error: "No tiene permiso para reasignar armas fuera de su puesto u operación asignada." }, { status: 403 })
      }
    }

    const { data: weapon, error: weaponError } = await admin
      .from("weapons")
      .select("id,serial,model,status,assigned_to,ammo_count")
      .eq("id", weaponId)
      .maybeSingle<WeaponRow>()

    if (weaponError) {
      return NextResponse.json({ ok: false, error: "No se pudo consultar el arma seleccionada." }, { status: 500 })
    }

    if (!weapon) {
      return NextResponse.json({ ok: false, error: "El arma seleccionada no existe." }, { status: 404 })
    }

    const nextStatus = reason === "dano" ? "Mantenimiento" : "Asignada"
    const timestamp = new Date().toISOString()

    let updateError: { message?: string } | null = null
    let ammoOmitted = false

    const updateAttempt = await admin
      .from("weapons")
      .update({
        assigned_to: targetPost,
        status: nextStatus,
        ammo_count: ammoCount,
        last_check: timestamp,
      })
      .eq("id", weaponId)

    updateError = updateAttempt.error

    if (updateError && hasAmmoColumnError(updateError.message)) {
      ammoOmitted = true
      const fallbackAttempt = await admin
        .from("weapons")
        .update({
          assigned_to: targetPost,
          status: nextStatus,
          last_check: timestamp,
        })
        .eq("id", weaponId)

      updateError = fallbackAttempt.error
    }

    if (updateError) {
      return NextResponse.json({
        ok: false,
        error: hasAmmoColumnError(updateError.message)
          ? "Falta el campo ammo_count en BD. Ejecuta la migración de municiones antes de usar este módulo."
          : "No se pudo actualizar el arma seleccionada.",
      }, { status: 500 })
    }

    const { error: logError } = await admin
      .from("weapon_control_logs")
      .insert({
        weapon_id: weapon.id,
        weapon_serial: weapon.serial ?? null,
        weapon_model: weapon.model ?? null,
        changed_by_user_id: actor.uid,
        changed_by_email: actor.email,
        changed_by_name: actor.firstName,
        reason,
        previous_data: {
          assignedTo: String(weapon.assigned_to ?? ""),
          status: String(weapon.status ?? ""),
          ammoCount: Number(weapon.ammo_count ?? 0),
        },
        new_data: {
          assignedTo: targetPost,
          status: nextStatus,
          ammoCount,
        },
        created_at: timestamp,
      })

    return NextResponse.json({
      ok: true,
      warning: logError
        ? "El arma se actualizó, pero no se pudo guardar la trazabilidad en bitácora."
        : ammoOmitted
          ? "El control se aplicó sin actualizar municiones porque la columna ammo_count aún no existe en la base."
          : null,
    })
  } catch {
    return NextResponse.json({ ok: false, error: "Error inesperado aplicando control de armas." }, { status: 500 })
  }
}