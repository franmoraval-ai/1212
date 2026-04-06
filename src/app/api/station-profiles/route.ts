import { NextResponse } from "next/server"
import { getAuthenticatedActor, isDirector, isManager } from "@/lib/server-auth"
import { resolveStationReference } from "@/lib/stations"
import { isOfficerAuthorizedForStation } from "@/lib/station-officer-authorizations"
import { isStationProfilesSchemaMissing, loadStationProfileForStation, loadStationProfiles } from "@/lib/station-profiles"

export async function GET(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  const url = new URL(request.url)
  if (url.searchParams.get("authorized") === "1") {
    if (isDirector(actor)) {
      return NextResponse.json({ profiles: [] })
    }

    const { data: authorizations, error: authorizationError } = await admin
      .from("station_officer_authorizations")
      .select("operation_catalog_id,is_active,valid_from,valid_to")
      .eq("officer_user_id", actor.userId)

    if (authorizationError) {
      if (String(authorizationError.message ?? "").toLowerCase().includes("station_officer_authorizations")) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de usar puestos autorizados L1." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudieron cargar los puestos autorizados del oficial." }, { status: 500 })
    }

    const now = Date.now()
    const operationCatalogIds = Array.from(new Set(((authorizations ?? []) as Array<{
      operation_catalog_id?: string | null
      is_active?: boolean | null
      valid_from?: string | null
      valid_to?: string | null
    }>)
      .filter((row) => {
        if (row.is_active === false) return false
        const validFrom = row.valid_from ? new Date(row.valid_from).getTime() : null
        const validTo = row.valid_to ? new Date(row.valid_to).getTime() : null
        if (validFrom && Number.isFinite(validFrom) && validFrom > now) return false
        if (validTo && Number.isFinite(validTo) && validTo < now) return false
        return true
      })
      .map((row) => String(row.operation_catalog_id ?? "").trim())
      .filter(Boolean)))

    if (operationCatalogIds.length === 0) {
      const fallbackStation = resolveStationReference({ assigned: actor.assigned })
      if (!String(fallbackStation.postName ?? "").trim()) {
        return NextResponse.json({ profiles: [] })
      }

      const exactCatalog = await admin
        .from("operation_catalog")
        .select("id,operation_name,client_name,is_active")
        .eq("operation_name", fallbackStation.operationName)
        .eq("client_name", fallbackStation.postName)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle()

      if (exactCatalog.error) {
        return NextResponse.json({ error: "No se pudo resolver el puesto base del oficial." }, { status: 500 })
      }

      const fallbackCatalog = exactCatalog.data?.id
        ? exactCatalog.data
        : (await admin
            .from("operation_catalog")
            .select("id,operation_name,client_name,is_active")
            .eq("client_name", fallbackStation.postName)
            .eq("is_active", true)
            .limit(1)
            .maybeSingle()).data

      if (!fallbackCatalog?.id) {
        return NextResponse.json({ profiles: [] })
      }

      const fallbackProfiles = await loadStationProfiles(admin, [String(fallbackCatalog.id)])
      if (!fallbackProfiles.ok) {
        if (!isStationProfilesSchemaMissing(String(fallbackProfiles.error ?? ""))) {
          return NextResponse.json({ error: "No se pudieron cargar los puestos autorizados del oficial." }, { status: 500 })
        }
      } else if (fallbackProfiles.records.length > 0) {
        return NextResponse.json({ profiles: fallbackProfiles.records })
      }

      return NextResponse.json({
        profiles: [{
          id: `fallback-${String(fallbackCatalog.id)}`,
          operationCatalogId: String(fallbackCatalog.id),
          operationName: String(fallbackCatalog.operation_name ?? fallbackStation.operationName ?? "").trim(),
          postName: String(fallbackCatalog.client_name ?? fallbackStation.postName ?? "").trim(),
          catalogIsActive: fallbackCatalog.is_active !== false,
          isEnabled: fallbackCatalog.is_active !== false,
          deviceLabel: null,
          notes: null,
          registeredAt: null,
          updatedAt: null,
        }],
      })
    }

    const result = await loadStationProfiles(admin, operationCatalogIds)
    if (!result.ok) {
      if (isStationProfilesSchemaMissing(String(result.error ?? ""))) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_profiles.sql antes de usar L1 operativo." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudieron cargar los puestos autorizados del oficial." }, { status: 500 })
    }

    return NextResponse.json({ profiles: result.records })
  }

  if (url.searchParams.get("current") === "1") {
    const requestedLabel = String(url.searchParams.get("stationLabel") ?? "").trim()
    const requestedPostName = String(url.searchParams.get("stationPostName") ?? "").trim()
    const candidate = requestedPostName || requestedLabel || (isDirector(actor) ? actor.assigned || "" : "")
    if (!candidate) {
      return NextResponse.json({ error: "Falta indicar el puesto operativo actual." }, { status: 400 })
    }

    const station = resolveStationReference({ assigned: actor.assigned, stationLabel: candidate })
    if (!isDirector(actor)) {
      const authorization = await isOfficerAuthorizedForStation(admin, actor.userId, station)
      if (!authorization.ok) {
        if (authorization.source === "schema-missing") {
          return NextResponse.json({ error: "Aplique la migración supabase/add_station_officer_authorizations.sql antes de usar L1 operativo." }, { status: 503 })
        }
        return NextResponse.json({ error: "No se pudo validar autorización del oficial para este puesto." }, { status: 500 })
      }

      if (!authorization.isAuthorized) {
        return NextResponse.json({ error: "El oficial no está autorizado para consultar este puesto operativo." }, { status: 403 })
      }
    }

    const result = await loadStationProfileForStation(admin, station)
    if (!result.ok) {
      if (isStationProfilesSchemaMissing(String(result.error ?? ""))) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_profiles.sql antes de usar L1 operativo." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo resolver el registro operativo del puesto." }, { status: 500 })
    }

    return NextResponse.json({
      profile: result.record,
      station: {
        key: station.key,
        label: station.label,
        operationName: station.operationName,
        postName: station.postName,
      },
    })
  }

  if (!isManager(actor)) {
    return NextResponse.json({ error: "Solo L3-L4 puede consultar registros L1 operativos." }, { status: 403 })
  }

  const operationCatalogIds = url.searchParams.getAll("operationCatalogId").map((value) => String(value).trim()).filter(Boolean)
  const result = await loadStationProfiles(admin, operationCatalogIds)

  if (!result.ok) {
    if (isStationProfilesSchemaMissing(String(result.error ?? ""))) {
      return NextResponse.json({ error: "Aplique la migración supabase/add_station_profiles.sql antes de usar L1 operativo." }, { status: 503 })
    }
    return NextResponse.json({ error: "No se pudieron cargar los puestos registrados en L1 operativo." }, { status: 500 })
  }

  return NextResponse.json({ profiles: result.records })
}

export async function POST(request: Request) {
  const { admin, actor, error, status } = await getAuthenticatedActor(request)
  if (!admin || !actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  if (!isDirector(actor)) {
    return NextResponse.json({ error: "Solo nivel 4 puede administrar registros L1 operativos." }, { status: 403 })
  }

  try {
    const body = (await request.json()) as {
      operationCatalogId?: string
      isEnabled?: boolean
      deviceLabel?: string | null
      notes?: string | null
    }

    const operationCatalogId = String(body.operationCatalogId ?? "").trim()
    const isEnabled = body.isEnabled !== false
    const deviceLabel = String(body.deviceLabel ?? "").trim() || null
    const notes = String(body.notes ?? "").trim() || null

    if (!operationCatalogId) {
      return NextResponse.json({ error: "Falta operationCatalogId." }, { status: 400 })
    }

    const { data: operation, error: operationError } = await admin
      .from("operation_catalog")
      .select("id")
      .eq("id", operationCatalogId)
      .maybeSingle()

    if (operationError) {
      return NextResponse.json({ error: "No se pudo validar el puesto solicitado." }, { status: 500 })
    }

    if (!operation?.id) {
      return NextResponse.json({ error: "Puesto no encontrado." }, { status: 404 })
    }

    const { error: upsertError } = await admin
      .from("station_profiles")
      .upsert({
        operation_catalog_id: operationCatalogId,
        is_enabled: isEnabled,
        device_label: deviceLabel,
        notes,
      }, { onConflict: "operation_catalog_id" })

    if (upsertError) {
      if (isStationProfilesSchemaMissing(String(upsertError.message ?? ""))) {
        return NextResponse.json({ error: "Aplique la migración supabase/add_station_profiles.sql antes de administrar L1 operativo." }, { status: 503 })
      }
      return NextResponse.json({ error: "No se pudo guardar el registro L1 operativo del puesto." }, { status: 500 })
    }

    const result = await loadStationProfiles(admin, [operationCatalogId])
    if (!result.ok) {
      return NextResponse.json({ error: "No se pudo recargar el registro guardado." }, { status: 500 })
    }

    return NextResponse.json({ ok: true, profile: result.records[0] ?? null })
  } catch {
    return NextResponse.json({ error: "Error inesperado guardando registro L1 operativo." }, { status: 500 })
  }
}