import type { SupabaseClient } from "@supabase/supabase-js"
import { getArchiveTableName, getLiveTableName, type DataOpsEntity } from "@/lib/data-ops"
import { hasCustomPermission, isDirector, type AuthenticatedActor } from "@/lib/server-auth"

export type ArchiveRunParams = {
  entityType: DataOpsEntity
  cutoffDate: string
  dryRun: boolean
  batchSize: number
}

export type RestoreRunParams = {
  runId: string
  dryRun: boolean
  batchSize: number
}

const archiveFieldMap: Record<DataOpsEntity, string[]> = {
  supervisions: [
    "operation_name",
    "officer_name",
    "type",
    "id_number",
    "weapon_model",
    "weapon_serial",
    "review_post",
    "lugar",
    "gps",
    "checklist",
    "checklist_reasons",
    "property_details",
    "observations",
    "photos",
    "supervisor_id",
    "status",
    "created_at",
  ],
  round_reports: [
    "round_id",
    "round_name",
    "post_name",
    "officer_id",
    "officer_name",
    "supervisor_name",
    "started_at",
    "ended_at",
    "status",
    "checkpoints_total",
    "checkpoints_completed",
    "checkpoint_logs",
    "notes",
    "created_at",
  ],
  incidents: [
    "title",
    "description",
    "incident_type",
    "location",
    "lugar",
    "time",
    "priority_level",
    "reasoning",
    "reported_by",
    "status",
    "created_at",
  ],
  internal_notes: [
    "post_name",
    "category",
    "priority",
    "detail",
    "status",
    "reported_by_user_id",
    "reported_by_name",
    "reported_by_email",
    "assigned_to",
    "resolution_note",
    "resolved_at",
    "updated_at",
    "created_at",
  ],
  visitors: [
    "name",
    "document_id",
    "visited_person",
    "destination",
    "post",
    "status",
    "entry_time",
    "exit_time",
    "created_at",
  ],
  weapons: [
    "serial",
    "model",
    "type",
    "status",
    "assigned_to",
    "ammo_count",
    "location",
    "last_check",
    "created_at",
  ],
}

const autoRetentionDays: Record<DataOpsEntity, number> = {
  supervisions: 90,
  round_reports: 90,
  incidents: 180,
  internal_notes: 120,
  visitors: 60,
  weapons: 365,
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function canManageDataOps(actor: AuthenticatedActor | null) {
  return isDirector(actor) || hasCustomPermission(actor, "data_ops_manage")
}

export function getArchiveFields(entityType: DataOpsEntity) {
  return archiveFieldMap[entityType]
}

export function getAutoArchivePlans(referenceDate = new Date()) {
  return (Object.keys(autoRetentionDays) as DataOpsEntity[]).map((entityType) => {
    const cutoff = new Date(referenceDate)
    cutoff.setUTCDate(cutoff.getUTCDate() - autoRetentionDays[entityType])
    return {
      entityType,
      cutoffDate: toIsoDate(cutoff),
      retentionDays: autoRetentionDays[entityType],
    }
  })
}

export async function executeArchiveRun(admin: SupabaseClient, actor: Pick<AuthenticatedActor, "uid" | "email">, params: ArchiveRunParams) {
  const batchSize = Math.min(Math.max(Number(params.batchSize ?? 500), 1), 2000)
  const { data: run, error: runInsertError } = await admin
    .from("data_archive_runs")
    .insert({
      entity_type: params.entityType,
      cutoff_date: params.cutoffDate,
      dry_run: params.dryRun,
      batch_size: batchSize,
      requested_by_uid: actor.uid,
      requested_by_email: actor.email,
      status: "processing",
    })
    .select("id")
    .single()

  if (runInsertError || !run?.id) {
    throw new Error(runInsertError?.message ?? "No se pudo crear corrida de archivado.")
  }

  try {
    const liveTable = getLiveTableName(params.entityType)
    const archiveTable = getArchiveTableName(params.entityType)
    const archiveFields = getArchiveFields(params.entityType)
    const selectFields = ["id", ...archiveFields].join(",")

    const { data: sourceRows, error: sourceError } = await admin
      .from(liveTable)
      .select(selectFields)
      .lt("created_at", `${params.cutoffDate}T00:00:00.000Z`)
      .order("created_at", { ascending: true })
      .limit(batchSize)

    if (sourceError) {
      throw new Error(sourceError.message)
    }

    const rows = (sourceRows ?? []) as unknown as Array<Record<string, unknown>>
    const matchedCount = rows.length

    if (params.dryRun || matchedCount === 0) {
      await admin
        .from("data_archive_runs")
        .update({
          status: "completed",
          matched_count: matchedCount,
          archived_count: 0,
          deleted_count: 0,
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", run.id)

      return { runId: String(run.id), matchedCount, archivedCount: 0, deletedCount: 0, dryRun: params.dryRun }
    }

    const archivePayload = rows.map((row) => {
      const nextRow: Record<string, unknown> = {
        original_id: row.id,
        archive_run_id: run.id,
        archived_at: new Date().toISOString(),
        archived_by: actor.email,
      }

      for (const field of archiveFields) {
        nextRow[field] = row[field]
      }

      return nextRow
    })

    const { error: insertError } = await admin.from(archiveTable).upsert(archivePayload, { onConflict: "original_id" })
    if (insertError) {
      throw new Error(insertError.message)
    }

    const idsToDelete = rows.map((row) => row.id).filter(Boolean) as string[]
    let deletedCount = 0
    if (idsToDelete.length > 0) {
      const { error: deleteError, count } = await admin
        .from(liveTable)
        .delete({ count: "exact" })
        .in("id", idsToDelete)

      if (deleteError) {
        throw new Error(deleteError.message)
      }

      deletedCount = Number(count ?? idsToDelete.length)
    }

    await admin
      .from("data_archive_runs")
      .update({
        status: "completed",
        matched_count: matchedCount,
        archived_count: archivePayload.length,
        deleted_count: deletedCount,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", run.id)

    return { runId: String(run.id), matchedCount, archivedCount: archivePayload.length, deletedCount, dryRun: false }
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "No se pudo completar el archivado."
    await admin
      .from("data_archive_runs")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", run.id)
    throw new Error(message)
  }
}

export async function executeRestoreRun(admin: SupabaseClient, actor: Pick<AuthenticatedActor, "uid" | "email">, params: RestoreRunParams) {
  const batchSize = Math.min(Math.max(Number(params.batchSize ?? 500), 1), 2000)
  const { data: archiveRun, error: archiveRunError } = await admin
    .from("data_archive_runs")
    .select("id, entity_type")
    .eq("id", params.runId)
    .maybeSingle()

  if (archiveRunError) {
    throw new Error(archiveRunError.message)
  }

  if (!archiveRun?.id || !archiveRun.entity_type) {
    throw new Error("Corrida de archivo no encontrada.")
  }

  const entityType = String(archiveRun.entity_type) as DataOpsEntity
  const { data: restoreRun, error: restoreInsertError } = await admin
    .from("data_restore_runs")
    .insert({
      source_run_id: params.runId,
      entity_type: entityType,
      dry_run: params.dryRun,
      batch_size: batchSize,
      requested_by_uid: actor.uid,
      requested_by_email: actor.email,
      status: "processing",
    })
    .select("id")
    .single()

  if (restoreInsertError || !restoreRun?.id) {
    throw new Error(restoreInsertError?.message ?? "No se pudo crear corrida de restauracion.")
  }

  try {
    const archiveTable = getArchiveTableName(entityType)
    const liveTable = getLiveTableName(entityType)
    const archiveFields = getArchiveFields(entityType)
    const { data: archivedRows, error: archivedRowsError } = await admin
      .from(archiveTable)
      .select(["original_id", ...archiveFields].join(","))
      .eq("archive_run_id", params.runId)
      .order("created_at", { ascending: true })
      .limit(batchSize)

    if (archivedRowsError) {
      throw new Error(archivedRowsError.message)
    }

    const rows = (archivedRows ?? []) as unknown as Array<Record<string, unknown>>
    const matchedCount = rows.length

    if (params.dryRun || matchedCount === 0) {
      await admin
        .from("data_restore_runs")
        .update({
          status: "completed",
          matched_count: matchedCount,
          restored_count: 0,
          removed_from_archive_count: 0,
          completed_at: new Date().toISOString(),
          error_message: null,
        })
        .eq("id", restoreRun.id)

      return { restoreRunId: String(restoreRun.id), matchedCount, restoredCount: 0, removedFromArchiveCount: 0, dryRun: params.dryRun }
    }

    const restorePayload = rows.map((row) => {
      const nextRow: Record<string, unknown> = { id: row.original_id }
      for (const field of archiveFields) {
        nextRow[field] = row[field]
      }
      return nextRow
    })

    const { error: upsertError } = await admin.from(liveTable).upsert(restorePayload, { onConflict: "id" })
    if (upsertError) {
      throw new Error(upsertError.message)
    }

    const originalIds = rows.map((row) => row.original_id).filter(Boolean) as string[]
    let removedFromArchiveCount = 0
    if (originalIds.length > 0) {
      const { error: deleteError, count } = await admin
        .from(archiveTable)
        .delete({ count: "exact" })
        .in("original_id", originalIds)
        .eq("archive_run_id", params.runId)

      if (deleteError) {
        throw new Error(deleteError.message)
      }

      removedFromArchiveCount = Number(count ?? originalIds.length)
    }

    await admin
      .from("data_restore_runs")
      .update({
        status: "completed",
        matched_count: matchedCount,
        restored_count: restorePayload.length,
        removed_from_archive_count: removedFromArchiveCount,
        completed_at: new Date().toISOString(),
        error_message: null,
      })
      .eq("id", restoreRun.id)

    return {
      restoreRunId: String(restoreRun.id),
      matchedCount,
      restoredCount: restorePayload.length,
      removedFromArchiveCount,
      dryRun: false,
    }
  } catch (processingError) {
    const message = processingError instanceof Error ? processingError.message : "No se pudo completar la restauracion."
    await admin
      .from("data_restore_runs")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString() })
      .eq("id", restoreRun.id)
    throw new Error(message)
  }
}