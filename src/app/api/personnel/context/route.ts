import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { isManagerHierarchySchemaMissing } from "@/lib/manager-hierarchy"
import { getAuthenticatedActor, hasCustomPermission, isDirector } from "@/lib/server-auth"

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
  personnel_code?: string | null
  first_name?: string | null
  email?: string | null
  role_level?: number | null
  status?: string | null
  assigned?: string | null
  manager_user_id?: string | null
  is_online?: boolean | null
  last_seen?: string | null
}

type PreregisteredPersonnelRow = {
  id: string
  personnel_code?: string | null
  full_name?: string | null
  id_number?: string | null
  phone?: string | null
  personnel_registry_assignments?: Array<{
    operation_catalog_id?: string | null
    is_active?: boolean | null
    operation_catalog?: { operation_name?: string | null; client_name?: string | null } | null
  }> | null
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
    personnelCode: String(row.personnel_code ?? ""),
    firstName: String(row.first_name ?? ""),
    email: String(row.email ?? ""),
    roleLevel: Number(row.role_level ?? 1),
    status: String(row.status ?? ""),
    assigned: String(row.assigned ?? ""),
    managerUserId: row.manager_user_id ? String(row.manager_user_id) : null,
    isOnline: Boolean(row.is_online ?? false),
    lastSeen: row.last_seen ? String(row.last_seen) : null,
  }
}

function normalizePreregisteredPersonnel(row: PreregisteredPersonnelRow) {
  const assignments = Array.isArray(row.personnel_registry_assignments)
    ? row.personnel_registry_assignments.filter((assignment) => assignment.is_active !== false)
    : []

  return {
    id: String(row.id ?? ""),
    personnelCode: String(row.personnel_code ?? ""),
    fullName: String(row.full_name ?? ""),
    idNumber: String(row.id_number ?? ""),
    phone: String(row.phone ?? ""),
    assignments: assignments.map((assignment) => ({
      operationCatalogId: String(assignment.operation_catalog_id ?? ""),
      operationName: String(assignment.operation_catalog?.operation_name ?? ""),
      postName: String(assignment.operation_catalog?.client_name ?? ""),
    })),
  }
}

async function readPersonnelRows(client: ReturnType<typeof createRequestSupabaseClient>) {
  const result = await client
    .from("users")
    .select("id,personnel_code,first_name,email,role_level,status,assigned,manager_user_id,is_online,last_seen")
    .order("role_level", { ascending: false })
    .order("first_name", { ascending: true })

  if (!result.error) return result

  const message = String(result.error.message ?? "").toLowerCase()
  if (!message.includes("personnel_code") && !isManagerHierarchySchemaMissing(message)) {
    return result
  }

  const withoutPersonnelCode = await client
    .from("users")
    .select("id,first_name,email,role_level,status,assigned,manager_user_id,is_online,last_seen")
    .order("role_level", { ascending: false })
    .order("first_name", { ascending: true })

  if (!withoutPersonnelCode.error) return withoutPersonnelCode

  if (isManagerHierarchySchemaMissing(String(withoutPersonnelCode.error.message ?? ""))) {
    return client
      .from("users")
      .select("id,first_name,email,role_level,status,assigned,is_online,last_seen")
      .order("role_level", { ascending: false })
      .order("first_name", { ascending: true })
  }

  return withoutPersonnelCode
}

export async function GET(request: Request) {
  const bearerToken = getBearerTokenFromRequest(request)
  if (!bearerToken) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 })
  }

  const { actor, admin, error, status } = await getAuthenticatedActor(request)
  if (!actor || !admin) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  try {
    const client = createRequestSupabaseClient(bearerToken)
    const canCreateUsers = isDirector(actor) || hasCustomPermission(actor, "personnel_create")
    const preregistrationsPromise = canCreateUsers
      ? admin
          .from("personnel_registry")
          .select("id,personnel_code,full_name,id_number,phone,personnel_registry_assignments(operation_catalog_id,is_active,operation_catalog(operation_name,client_name))")
          .eq("source", "PREREGISTRO")
          .eq("status", "ACTIVO")
          .is("linked_user_id", null)
          .order("full_name", { ascending: true })
      : Promise.resolve({ data: [], error: null })

    const [operationsResult, supervisionResult, personnelResult, preregistrationsResult] = await Promise.all([
      client
        .from("operation_catalog")
        .select("id,operation_name,client_name,is_active")
        .order("operation_name", { ascending: true }),
      client
        .from("supervisions")
        .select("created_at,officer_name,id_number,officer_phone,operation_name,review_post")
        .order("created_at", { ascending: false })
        .limit(400),
      readPersonnelRows(client),
      preregistrationsPromise,
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

    if (preregistrationsResult.error) {
      const message = String(preregistrationsResult.error.message ?? "")
      if (!message.toLowerCase().includes("personnel_registry")) {
        return NextResponse.json({ error: message || "No se pudieron cargar los prerregistros." }, { status: 500 })
      }
    }

    return NextResponse.json({
      operationsCatalog: Array.isArray(operationsResult.data) ? operationsResult.data.map((row) => normalizeOperationCatalog(row as OperationCatalogRow)) : [],
      supervisionSeeds: Array.isArray(supervisionResult.data) ? supervisionResult.data.map((row) => normalizeSupervisionSeed(row as SupervisionSeedRow)) : [],
      personnel: Array.isArray(personnelResult.data) ? personnelResult.data.map((row) => normalizePersonnel(row as PersonnelRow)) : [],
      preregisteredPersonnel: Array.isArray(preregistrationsResult.data)
        ? preregistrationsResult.data.map((row) => normalizePreregisteredPersonnel(row as unknown as PreregisteredPersonnelRow))
        : [],
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar personal." },
      { status: 500 }
    )
  }
}