import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"

type OperationCatalogRow = {
  id: string
  operation_name?: string | null
  client_name?: string | null
  is_active?: boolean | null
}

type SupervisionSeedRow = {
  created_at?: string | null
  officer_name?: string | null
  id_number?: string | null
  officer_phone?: string | null
  operation_name?: string | null
  review_post?: string | null
}

type PersonnelRow = {
  id: string
  first_name?: string | null
  email?: string | null
  role_level?: number | null
  status?: string | null
  assigned?: string | null
  is_online?: boolean | null
  last_seen?: string | null
}

function normalizeOperationCatalog(row: OperationCatalogRow) {
  return {
    id: String(row.id ?? ""),
    operationName: String(row.operation_name ?? ""),
    clientName: String(row.client_name ?? ""),
    isActive: row.is_active !== false,
  }
}

function normalizeSupervisionSeed(row: SupervisionSeedRow) {
  return {
    createdAt: row.created_at ? String(row.created_at) : null,
    officerName: String(row.officer_name ?? ""),
    idNumber: String(row.id_number ?? ""),
    officerPhone: String(row.officer_phone ?? ""),
    operationName: String(row.operation_name ?? ""),
    reviewPost: String(row.review_post ?? ""),
  }
}

function normalizePersonnel(row: PersonnelRow) {
  return {
    id: String(row.id ?? ""),
    firstName: String(row.first_name ?? ""),
    email: String(row.email ?? ""),
    roleLevel: Number(row.role_level ?? 1),
    status: String(row.status ?? ""),
    assigned: String(row.assigned ?? ""),
    isOnline: Boolean(row.is_online ?? false),
    lastSeen: row.last_seen ? String(row.last_seen) : null,
  }
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const [operationsResult, supervisionResult, personnelResult] = await Promise.all([
      client
        .from("operation_catalog")
        .select("id,operation_name,client_name,is_active")
        .order("operation_name", { ascending: true }),
      client
        .from("supervisions")
        .select("created_at,officer_name,id_number,officer_phone,operation_name,review_post")
        .order("created_at", { ascending: false })
        .limit(400),
      client
        .from("users")
        .select("id,first_name,email,role_level,status,assigned,is_online,last_seen")
        .order("role_level", { ascending: false })
        .order("first_name", { ascending: true }),
    ])

    if (operationsResult.error) {
      return NextResponse.json({ error: operationsResult.error.message ?? "No se pudo cargar personal." }, { status: 500 })
    }

    if (supervisionResult.error) {
      return NextResponse.json({ error: supervisionResult.error.message ?? "No se pudo cargar personal." }, { status: 500 })
    }

    if (personnelResult.error) {
      return NextResponse.json({ error: personnelResult.error.message ?? "No se pudo cargar personal." }, { status: 500 })
    }

    return NextResponse.json({
      operationsCatalog: Array.isArray(operationsResult.data) ? operationsResult.data.map((row) => normalizeOperationCatalog(row as OperationCatalogRow)) : [],
      supervisionSeeds: Array.isArray(supervisionResult.data) ? supervisionResult.data.map((row) => normalizeSupervisionSeed(row as SupervisionSeedRow)) : [],
      personnel: Array.isArray(personnelResult.data) ? personnelResult.data.map((row) => normalizePersonnel(row as PersonnelRow)) : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar personal." },
      { status: 500 }
    )
  }
}