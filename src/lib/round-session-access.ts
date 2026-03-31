import type { SupabaseClient } from "@supabase/supabase-js"
import type { AuthenticatedActor } from "@/lib/server-auth"

type RoundSessionRow = {
  id: string
  round_id: string | null
  officer_id: string | null
  supervisor_id: string | null
  status: string | null
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase()
}

export async function getAuthorizedRoundSession(
  admin: SupabaseClient,
  sessionId: string,
  actor: AuthenticatedActor
) {
  const { data: session, error } = await admin
    .from("round_sessions")
    .select("id, round_id, officer_id, supervisor_id, status")
    .eq("id", sessionId)
    .limit(1)
    .maybeSingle<RoundSessionRow>()

  if (error) {
    return { session: null, error: "No se pudo validar la sesión de ronda.", status: 500 }
  }

  if (!session?.id) {
    return { session: null, error: "Sesión de ronda no encontrada.", status: 404 }
  }

  const actorTokens = new Set([normalize(actor.uid), normalize(actor.email)])
  const officerId = normalize(session.officer_id)
  const supervisorId = normalize(session.supervisor_id)
  const isOwner = actorTokens.has(officerId) || actorTokens.has(supervisorId)
  const canAccess = Number(actor.roleLevel ?? 0) >= 4 || isOwner

  if (!canAccess) {
    return { session: null, error: "No tiene permiso para modificar esta sesión.", status: 403 }
  }

  return { session, error: null, status: 200 }
}