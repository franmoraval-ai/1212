import { NextResponse } from "next/server"
import { createClient as createAdminClient } from "@supabase/supabase-js"
import { createClient as createSessionClient } from "@/lib/supabase-server"

export async function POST() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      return NextResponse.json({ ok: true })
    }

    const sessionClient = await createSessionClient()
    const {
      data: { user },
      error: authError,
    } = await sessionClient.auth.getUser()

    if (authError || !user?.email) {
      return NextResponse.json({ ok: true })
    }

    const admin = createAdminClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    await admin
      .from("users")
      .update({ is_online: false, last_seen: new Date().toISOString() })
      .eq("email", user.email.toLowerCase())

    return NextResponse.json({ ok: true })
  } catch {
    // Endpoint best-effort: no bloquea el cierre de sesion en cliente.
    return NextResponse.json({ ok: true })
  }
}
