import { NextResponse } from "next/server"
import { createRequestSupabaseClient, getBearerTokenFromRequest } from "@/lib/request-supabase"
import { getAuthenticatedActor } from "@/lib/server-auth"
import { buildAssignedScope } from "@/lib/personnel-assignment"
import { resolveStationReference } from "@/lib/stations"

type RoundRow = {
  id: string
  name?: string | null
  post?: string | null
  status?: string | null
  frequency?: string | null
}

type RoundReportRow = {
  id: string
  round_id?: string | null
  round_name?: string | null
  created_at?: string | null
}

type InternalNoteRow = {
  id: string
  status?: string | null
  priority?: string | null
  detail?: string | null
  reported_by_name?: string | null
  post_name?: string | null
  created_at?: string | null
}

type IncidentRow = {
  id: string
  status?: string | null
  priority_level?: string | null
  incident_type?: string | null
  description?: string | null
  location?: string | null
  lugar?: string | null
  time?: string | null
  created_at?: string | null
}

function tokenizeScope(...values: Array<unknown>) {
  return values
    .flatMap((value) => String(value ?? "").split(/[|,;\-]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function matchesStationText(value: unknown, station: { label: string; postName: string }) {
  const candidate = normalizeSearchText(value)
  if (!candidate) return false

  const aliases = [station.postName, station.label]
    .map(normalizeSearchText)
    .filter(Boolean)

  return aliases.some((alias) => candidate === alias || candidate.includes(alias))
}

function buildStationAliases(station: { label: string; postName: string }) {
  return Array.from(new Set([String(station.postName ?? "").trim(), String(station.label ?? "").trim()].filter(Boolean)))
}

function getFrequencyMinutes(value: string) {
  const normalized = String(value ?? "").toLowerCase()
  const numeric = Number.parseInt(normalized.replace(/[^0-9]/g, ""), 10)
  if (normalized.includes("hora")) return Number.isFinite(numeric) && numeric > 0 ? numeric * 60 : 60
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  return 30
}

function getReportCreatedDate(report: RoundReportRow) {
  const raw = report.created_at
  if (!raw) return null
  const parsed = new Date(String(raw))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeRecentNote(row: InternalNoteRow) {
  return {
    id: String(row.id ?? ""),
    priority: String(row.priority ?? "media"),
    detail: String(row.detail ?? ""),
    reportedByName: String(row.reported_by_name ?? "Operador"),
    createdAt: row.created_at ?? null,
  }
}

function normalizeRecentIncident(row: IncidentRow, fallbackLabel: string) {
  return {
    id: String(row.id ?? ""),
    priorityLevel: String(row.priority_level ?? "Medium"),
    incidentType: String(row.incident_type ?? "Incidente"),
    description: String(row.description ?? ""),
    locationLabel: String(row.lugar ?? row.location ?? fallbackLabel ?? "Puesto"),
    occurredAt: row.time ?? row.created_at ?? null,
  }
}

function normalizeRoundCard(row: RoundRow, dueAtMs: number | null, fallbackPost: string) {
  return {
    id: String(row.id ?? ""),
    name: String(row.name ?? "Ronda"),
    post: String(row.post ?? fallbackPost ?? "Puesto"),
    dueAtMs,
  }
}

async function readRows<T>(promise: PromiseLike<{ data: T[] | null; error: { message?: string } | null }>) {
  const { data, error } = await promise
  return {
    rows: Array.isArray(data) ? data : [],
    error: error ? String(error.message ?? "Error desconocido") : null,
  }
}

async function readCount(promise: PromiseLike<{ count: number | null; error: { message?: string } | null }>) {
  const { count, error } = await promise
  return {
    count: Number(count ?? 0),
    error: error ? String(error.message ?? "Error desconocido") : null,
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
    const url = new URL(request.url)
    const stationOperationName = String(url.searchParams.get("stationOperationName") ?? "").trim()
    const stationPostName = String(url.searchParams.get("stationPostName") ?? "").trim()
    const stationLabel = String(url.searchParams.get("stationLabel") ?? stationPostName).trim()
    const assignedScope = stationOperationName && stationPostName
      ? buildAssignedScope(stationOperationName, stationPostName)
      : String(actor.assigned ?? "")

    if (!stationLabel && !stationPostName && !assignedScope) {
      return NextResponse.json({
        roundCards: [],
        openNotesCount: 0,
        recentStationNotes: [],
        openIncidentsCount: 0,
        recentStationIncidents: [],
        warnings: [],
      })
    }

    const station = resolveStationReference({ assigned: assignedScope, stationLabel })
    const client = createRequestSupabaseClient(bearerToken)
    const stationScopeTokens = tokenizeScope(station.operationName, station.postName, station.label)
    const stationAliases = buildStationAliases(station)

    const buildStationIncidentsQuery = (field: "lugar" | "location") => {
      let query: any = client
        .from("incidents")
        .select("id,status,priority_level,incident_type,description,location,lugar,time,created_at")

      if (typeof query?.neq === "function") {
        query = query.neq("status", "cerrado")
      }

      if (stationAliases.length > 0 && typeof query?.in === "function") {
        query = query.in(field, stationAliases)
      }

      return query
        .order("time", { ascending: false })
        .limit(300)
    }

    const roundsResult = await readRows<RoundRow>(
      client
        .from("rounds")
        .select("id,name,post,status,frequency")
        .order("name", { ascending: true })
    )

    const scopedRounds = roundsResult.rows.filter((round) => {
      if (String(round.status ?? "").trim().toLowerCase() !== "activa") return false
      if (stationScopeTokens.length === 0) return true
      const haystack = `${String(round.name ?? "")} ${String(round.post ?? "")}`.toLowerCase()
      return stationScopeTokens.some((token) => haystack.includes(token))
    })

    const scopedRoundIds = scopedRounds.map((round) => String(round.id ?? "").trim()).filter(Boolean)
    const scopedRoundNames = scopedRounds.map((round) => String(round.name ?? "").trim()).filter(Boolean)
    let reportsResult = scopedRoundIds.length > 0
      ? await readRows<RoundReportRow>(
          client
            .from("round_reports")
            .select("id,round_id,round_name,created_at")
            .in("round_id", scopedRoundIds)
            .order("created_at", { ascending: false })
        )
      : { rows: [] as RoundReportRow[], error: null as string | null }

    if (!reportsResult.error && reportsResult.rows.length === 0 && scopedRoundNames.length > 0) {
      reportsResult = await readRows<RoundReportRow>(
        client
          .from("round_reports")
          .select("id,round_id,round_name,created_at")
          .in("round_name", scopedRoundNames)
          .order("created_at", { ascending: false })
      )
    }

    const [notesCountResult, recentNotesResult, incidentsByLugarResult, incidentsByLocationResult, incidentsFallbackResult] = await Promise.all([
      stationAliases.length > 0
        ? readCount(
            client
              .from("internal_notes")
              .select("id", { count: "exact", head: true })
              .neq("status", "resuelta")
              .in("post_name", stationAliases)
          )
        : Promise.resolve({ count: 0, error: null as string | null }),
      stationAliases.length > 0
        ? readRows<InternalNoteRow>(
            client
              .from("internal_notes")
              .select("id,status,priority,detail,reported_by_name,post_name,created_at")
              .neq("status", "resuelta")
              .in("post_name", stationAliases)
              .order("created_at", { ascending: false })
              .limit(3)
          )
        : Promise.resolve({ rows: [] as InternalNoteRow[], error: null as string | null }),
      stationAliases.length > 0
        ? readRows<IncidentRow>(
            buildStationIncidentsQuery("lugar")
          )
        : Promise.resolve({ rows: [] as IncidentRow[], error: null as string | null }),
      stationAliases.length > 0
        ? readRows<IncidentRow>(
            buildStationIncidentsQuery("location")
          )
        : Promise.resolve({ rows: [] as IncidentRow[], error: null as string | null }),
      readRows<IncidentRow>(
        client
          .from("incidents")
          .select("id,status,priority_level,incident_type,description,location,lugar,time,created_at")
          .order("time", { ascending: false })
          .limit(120)
      ),
    ])

    const latestReportByRound = new Map<string, Date>()

    for (const report of reportsResult.rows) {
      const reportRoundKey = String(report.round_id ?? report.round_name ?? "").trim()
      const createdAt = getReportCreatedDate(report)
      if (!createdAt) continue
      if (!reportRoundKey) continue

      const previous = latestReportByRound.get(reportRoundKey)
      if (!previous || createdAt > previous) {
        latestReportByRound.set(reportRoundKey, createdAt)
      }
    }

    const roundCards = scopedRounds.map((round) => {
      const roundId = String(round.id ?? "").trim()
      const roundName = String(round.name ?? "").trim()
      const lastReportAt = latestReportByRound.get(roundId) ?? latestReportByRound.get(roundName) ?? null
      const frequencyMinutes = getFrequencyMinutes(String(round.frequency ?? ""))
      const dueAtMs = lastReportAt ? lastReportAt.getTime() + frequencyMinutes * 60 * 1000 : null
      return normalizeRoundCard(round, dueAtMs, station.postName || station.label)
    })

    const incidentById = new Map<string, IncidentRow>()
    for (const incident of [...incidentsByLugarResult.rows, ...incidentsByLocationResult.rows]) {
      const id = String(incident.id ?? "").trim()
      if (id) incidentById.set(id, incident)
    }

    const incidentCandidates = incidentById.size > 0
      ? Array.from(incidentById.values())
      : incidentsFallbackResult.rows

    const openIncidents = incidentCandidates.filter((incident) => {
      const incidentStatus = String(incident.status ?? "Abierto").trim().toLowerCase()
      if (incidentStatus === "cerrado") return false
      return matchesStationText(incident.lugar ?? incident.location, station)
    })

    const warnings = [
      roundsResult.error ? `rounds:${roundsResult.error}` : null,
      reportsResult.error ? `round_reports:${reportsResult.error}` : null,
      notesCountResult.error ? `internal_notes_count:${notesCountResult.error}` : null,
      recentNotesResult.error ? `internal_notes_recent:${recentNotesResult.error}` : null,
      incidentsByLugarResult.error ? `incidents_lugar:${incidentsByLugarResult.error}` : null,
      incidentsByLocationResult.error ? `incidents_location:${incidentsByLocationResult.error}` : null,
      incidentsFallbackResult.error ? `incidents_fallback:${incidentsFallbackResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      roundCards,
      openNotesCount: notesCountResult.count,
      recentStationNotes: recentNotesResult.rows.map(normalizeRecentNote),
      openIncidentsCount: openIncidents.length,
      recentStationIncidents: openIncidents.slice(0, 3).map((incident) => normalizeRecentIncident(incident, station.label)),
      warnings,
    })
  } catch (nextError) {
    return NextResponse.json(
      { error: nextError instanceof Error ? nextError.message : "No se pudo cargar el puesto activo." },
      { status: 500 }
    )
  }
}