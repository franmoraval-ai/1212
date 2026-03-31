import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"
import { hasPermission, normalizePermissions, type CustomPermission } from "@/lib/access-control"

type AdminClientResult = {
  admin: SupabaseClient | null
  error: string | null
}

export type AuthenticatedActor = {
  uid: string
  email: string
  firstName: string | null
  status: string | null
  assigned: string | null
  roleLevel: number
  customPermissions: CustomPermission[]
}

function normalizeUserStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

function isActiveUserStatus(value: unknown) {
  const normalized = normalizeUserStatus(value)
  return normalized === "active" || normalized === "activo"
}

function buildAdminClient(): AdminClientResult {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      admin: null,
      error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY o SUPABASE_SECRET_KEY en el servidor.",
    }
  }

  return {
    admin: createSupabaseClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }),
    error: null,
  }
}

export function getAdminClient(): AdminClientResult {
  return buildAdminClient()
}

async function resolveActorIdentity(admin: SupabaseClient, request?: Request) {
  const sessionClient = await createSessionClient()
  const {
    data: { user: cookieUser },
    error: cookieAuthError,
  } = await sessionClient.auth.getUser()

  if (!cookieAuthError && cookieUser?.id && cookieUser.email) {
    return {
      uid: cookieUser.id,
      email: String(cookieUser.email).trim().toLowerCase(),
    }
  }

  const authHeader = request?.headers.get("authorization")
  const bearerToken = authHeader?.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : ""

  if (!bearerToken) return null

  const {
    data: { user: bearerUser },
    error: bearerAuthError,
  } = await admin.auth.getUser(bearerToken)

  if (bearerAuthError || !bearerUser?.id || !bearerUser.email) return null

  return {
    uid: bearerUser.id,
    email: String(bearerUser.email).trim().toLowerCase(),
  }
}

export async function getAuthenticatedActor(request?: Request): Promise<{
  admin: SupabaseClient | null
  actor: AuthenticatedActor | null
  error: string | null
  status: number
}> {
  const { admin, error } = buildAdminClient()
  if (!admin) {
    return { admin: null, actor: null, error, status: 500 }
  }

  const identity = await resolveActorIdentity(admin, request)
  if (!identity?.email) {
    return { admin, actor: null, error: "No autenticado.", status: 401 }
  }

  const { data: profile, error: profileError } = await admin
    .from("users")
    .select("first_name, status, role_level, assigned, custom_permissions")
    .ilike("email", identity.email)
    .limit(1)
    .maybeSingle()

  if (profileError) {
    return { admin, actor: null, error: "No se pudo validar permisos del usuario.", status: 500 }
  }

  if (!profile) {
    return { admin, actor: null, error: "Usuario no provisionado.", status: 403 }
  }

  if (!isActiveUserStatus(profile.status)) {
    return { admin, actor: null, error: "Usuario inactivo.", status: 403 }
  }

  return {
    admin,
    actor: {
      uid: identity.uid,
      email: identity.email,
      firstName: (profile?.first_name as string | null | undefined) ?? null,
      status: (profile?.status as string | null | undefined) ?? null,
      assigned: (profile?.assigned as string | null | undefined) ?? null,
      roleLevel: Number(profile?.role_level ?? 1),
      customPermissions: normalizePermissions(profile?.custom_permissions),
    },
    error: null,
    status: 200,
  }
}

export function isManager(actor: AuthenticatedActor | null) {
  return Number(actor?.roleLevel ?? 0) >= 3
}

export function isDirector(actor: AuthenticatedActor | null) {
  return Number(actor?.roleLevel ?? 0) >= 4
}

export function hasCustomPermission(actor: AuthenticatedActor | null, permission: CustomPermission) {
  return hasPermission(actor?.customPermissions, permission)
}

export function getAssignableRoleLimit(actor: AuthenticatedActor | null) {
  if (!actor) return 0
  if (isDirector(actor)) return 4
  if (hasCustomPermission(actor, "personnel_create")) return 2
  return 0
}