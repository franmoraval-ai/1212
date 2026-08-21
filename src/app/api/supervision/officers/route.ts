import { NextResponse } from "next/server"
import { writeAuditEvent } from "@/lib/audit-log"
import { getAuthenticatedActor } from "@/lib/server-auth"

function normalizeText(value: unknown) {
  return String(value ?? "").trim()
}

function normalizeIdentityNumber(value: unknown) {
  return normalizeText(value).toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function isRegistrySchemaMissing(message: unknown) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("personnel_registry") || normalized.includes("officer_registry_id")
}

function mapRegistryOfficer(row: Record<string, unknown>, operationCatalogId: string) {
  return {
    id: String(row.id ?? ""),
    linkedUserId: row.linked_user_id ? String(row.linked_user_id) : null,
    name: String(row.full_name ?? "").trim(),
    personnelCode: String(row.personnel_code ?? "").trim(),
    idNumber: String(row.id_number ?? "").trim(),
    phone: String(row.phone ?? "").trim(),
    source: String(row.source ?? "PREREGISTRO"),
    operationCatalogIds: [operationCatalogId],
  }
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (Number(actor.roleLevel ?? 0) < 2) {
    return NextResponse.json({ error: "Solo L2-L4 puede prerregistrar oficiales desde Supervisión." }, { status: 403 })
  }

  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const name = normalizeText(body.name)
    const idNumber = normalizeText(body.idNumber).toUpperCase()
    const normalizedIdNumber = normalizeIdentityNumber(idNumber)
    const phone = normalizeText(body.phone)
    const operationCatalogId = normalizeText(body.operationCatalogId)

    if (name.length < 2 || name.length > 160) {
      return NextResponse.json({ error: "Indique el nombre completo del oficial." }, { status: 400 })
    }
    if (normalizedIdNumber.length < 3 || normalizedIdNumber.length > 40) {
      return NextResponse.json({ error: "Indique una cédula o ID válido." }, { status: 400 })
    }
    if (phone && (phone.length < 4 || phone.length > 30)) {
      return NextResponse.json({ error: "El teléfono indicado no es válido." }, { status: 400 })
    }
    if (!operationCatalogId) {
      return NextResponse.json({ error: "Seleccione primero una operación y puesto." }, { status: 400 })
    }

    const { data: operation, error: operationError } = await admin
      .from("operation_catalog")
      .select("id")
      .eq("id", operationCatalogId)
      .eq("is_active", true)
      .maybeSingle()

    if (operationError) {
      return NextResponse.json({ error: "No se pudo validar el puesto seleccionado." }, { status: 500 })
    }
    if (!operation?.id) {
      return NextResponse.json({ error: "El puesto seleccionado no está activo." }, { status: 400 })
    }

    const { data: registryRows, error: registryReadError } = await admin
      .from("personnel_registry")
      .select("id,personnel_code,linked_user_id,full_name,id_number,phone,status,source")

    if (registryReadError) {
      if (isRegistrySchemaMissing(registryReadError.message)) {
        return NextResponse.json({ error: "Aplique supabase/create_personnel_registry.sql antes de prerregistrar oficiales." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo consultar el registro de oficiales." }, { status: 500 })
    }

    const existing = ((registryRows ?? []) as Array<Record<string, unknown>>).find((row) => (
      normalizeIdentityNumber(row.id_number) === normalizedIdNumber
    ))

    let profile: Record<string, unknown>
    let created = false
    if (existing) {
      if (String(existing.status ?? "ACTIVO").toUpperCase() !== "ACTIVO") {
        return NextResponse.json({ error: "La cédula indicada pertenece a un oficial inactivo." }, { status: 409 })
      }
      profile = existing

      if (phone && !normalizeText(existing.phone)) {
        const { error: phoneUpdateError } = await admin
          .from("personnel_registry")
          .update({ phone, updated_at: new Date().toISOString() })
          .eq("id", String(existing.id))
        if (phoneUpdateError) {
          return NextResponse.json({ error: "No se pudo completar el teléfono del oficial existente." }, { status: 500 })
        }
        profile = { ...existing, phone }
      }
    } else {
      const { data: inserted, error: insertError } = await admin
        .from("personnel_registry")
        .insert({
          full_name: name,
          id_number: idNumber,
          phone: phone || null,
          status: "ACTIVO",
          source: "PREREGISTRO",
          created_by_user_id: actor.userId,
        })
        .select("id,personnel_code,linked_user_id,full_name,id_number,phone,status,source")
        .single()

      if (insertError || !inserted) {
        const message = String(insertError?.message ?? "")
        if (isRegistrySchemaMissing(message)) {
          return NextResponse.json({ error: "Aplique supabase/create_personnel_registry.sql antes de prerregistrar oficiales." }, { status: 503 })
        }
        if (message.toLowerCase().includes("duplicate")) {
          return NextResponse.json({ error: "Ya existe un oficial con esa cédula. Recargue el directorio para seleccionarlo." }, { status: 409 })
        }
        return NextResponse.json({ error: "No se pudo crear el prerregistro del oficial." }, { status: 500 })
      }
      profile = inserted as Record<string, unknown>
      created = true
    }

    const { error: assignmentError } = await admin
      .from("personnel_registry_assignments")
      .upsert({
        personnel_registry_id: String(profile.id),
        operation_catalog_id: operationCatalogId,
        is_active: true,
        created_by_user_id: actor.userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "personnel_registry_id,operation_catalog_id" })

    if (assignmentError) {
      if (created) {
        await admin.from("personnel_registry").delete().eq("id", String(profile.id))
      }
      return NextResponse.json({ error: "No se pudo asociar el oficial con el puesto seleccionado." }, { status: 500 })
    }

    await writeAuditEvent(admin, actor, {
      action: created ? "supervision.officer_preregistered" : "supervision.officer_reused",
      resourceType: "personnel_registry",
      resourceId: String(profile.id),
      metadata: { operationCatalogId, source: String(profile.source ?? "PREREGISTRO") },
    }, request)

    return NextResponse.json({
      ok: true,
      created,
      officer: mapRegistryOfficer(profile, operationCatalogId),
    })
  } catch {
    return NextResponse.json({ error: "Error inesperado prerregistrando al oficial." }, { status: 500 })
  }
}