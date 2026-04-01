import { NextResponse } from "next/server"
import { canManageDataOps, executeArchiveRun, getAutoArchivePlans } from "@/lib/data-ops-archive"
import { getAdminClient, getAuthenticatedActor } from "@/lib/server-auth"

function hasValidCronSecret(request: Request) {
  const configuredSecret = process.env.DATA_OPS_CRON_SECRET ?? process.env.CRON_SECRET ?? ""
  if (!configuredSecret) return false

  const authHeader = request.headers.get("authorization") ?? ""
  const bearerToken = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : ""
  return bearerToken === configuredSecret
}

export async function GET(request: Request) {
  try {
    let actor = null as Awaited<ReturnType<typeof getAuthenticatedActor>>["actor"]
    let admin = null as Awaited<ReturnType<typeof getAuthenticatedActor>>["admin"]

    const authResult = await getAuthenticatedActor(request)
    if (authResult.admin && authResult.actor && canManageDataOps(authResult.actor)) {
      admin = authResult.admin
      actor = authResult.actor
    } else {
      if (!hasValidCronSecret(request)) {
        return NextResponse.json({ error: "Cron no autorizado." }, { status: 401 })
      }

      const adminClient = getAdminClient()
      if (!adminClient.admin) {
        return NextResponse.json({ error: adminClient.error ?? "Admin client no disponible." }, { status: 500 })
      }

      admin = adminClient.admin
      actor = {
        uid: "system-cron",
        email: "system-cron@local",
        firstName: "System Cron",
        status: "active",
        assigned: null,
        roleLevel: 4,
        customPermissions: [],
      }
    }

    if (!admin || !actor) {
      return NextResponse.json({ error: "No se pudo inicializar cron." }, { status: 500 })
    }

    const plans = getAutoArchivePlans()
    const results: Array<Record<string, unknown>> = []

    for (const plan of plans) {
      try {
        const result = await executeArchiveRun(admin, actor, {
          entityType: plan.entityType,
          cutoffDate: plan.cutoffDate,
          dryRun: false,
          batchSize: Number(process.env.DATA_OPS_AUTO_ARCHIVE_BATCH_SIZE ?? 500),
        })

        results.push({
          entityType: plan.entityType,
          cutoffDate: plan.cutoffDate,
          retentionDays: plan.retentionDays,
          ok: true,
          ...result,
        })
      } catch (error) {
        results.push({
          entityType: plan.entityType,
          cutoffDate: plan.cutoffDate,
          retentionDays: plan.retentionDays,
          ok: false,
          error: error instanceof Error ? error.message : "Error desconocido",
        })
      }
    }

    return NextResponse.json({ ok: true, mode: actor.uid === "system-cron" ? "cron" : "manual", results })
  } catch {
    return NextResponse.json({ error: "Error inesperado en cron de archivado." }, { status: 500 })
  }
}