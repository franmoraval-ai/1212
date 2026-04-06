import { NextResponse } from "next/server"
import { getAuthenticatedActor } from "@/lib/server-auth"

export async function GET(request: Request) {
  const { actor, error, status } = await getAuthenticatedActor(request)
  if (!actor) {
    return NextResponse.json({ error: error ?? "No autenticado." }, { status })
  }

  return NextResponse.json({
    user: {
      uid: actor.uid,
      email: actor.email,
      roleLevel: actor.roleLevel,
      firstName: actor.firstName,
      assigned: actor.assigned,
      customPermissions: actor.customPermissions,
    },
  })
}