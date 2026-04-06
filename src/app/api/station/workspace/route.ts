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
  post_name?: string | null
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

function getReportRoundKey(report: RoundReportRow) {
  return String(report.round_name ?? report.round_id ?? "").trim()
}

function readStationKey(value: unknown, assignedScope: string) {
  const candidate = String(value ?? "").trim()
  if (!candidate) return ""
  return resolveStationReference({ assigned: assignedScope, stationLabel: value }).key
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

    const [roundsResult, reportsResult, notesResult, incidentsResult] = await Promise.all([
      readRows<RoundRow>(
        client
          .from("rounds")
          .select("id,name,post,status,frequency")
          .order("name", { ascending: true })
      ),
      readRows<RoundReportRow>(
        client
          .from("round_reports")
          .select("id,round_id,round_name,post_name,created_at")
          .order("created_at", { ascending: false })
          .limit(300)
      ),
      readRows<InternalNoteRow>(
        client
          .from("internal_notes")
          .select("id,status,priority,detail,reported_by_name,post_name,created_at")
          .neq("status", "resuelta")
          .order("created_at", { ascending: false })
          .limit(120)
      ),
      readRows<IncidentRow>(
        client
          .from("incidents")
          .select("id,status,priority_level,incident_type,description,location,lugar,time,created_at")
          .order("time", { ascending: false })
          .limit(120)
      ),
    ])

    const scopedRounds = roundsResult.rows.filter((round) => {
      if (String(round.status ?? "").trim().toLowerCase() !== "activa") return false
      if (stationScopeTokens.length === 0) return true
      const haystack = `${String(round.name ?? "")} ${String(round.post ?? "")}`.toLowerCase()
      return stationScopeTokens.some((token) => haystack.includes(token))
    })

    const scopedRoundKeys = new Set(scopedRounds.map((round) => String(round.name ?? round.id ?? "").trim()).filter(Boolean))
    const stationKey = station.key
    const latestReportByRound = new Map<string, Date>()

    for (const report of reportsResult.rows) {
      const reportStationKey = readStationKey(report.post_name, assignedScope)
      const reportRoundKey = getReportRoundKey(report)
      const createdAt = getReportCreatedDate(report)
      if (!createdAt) continue
      if (!scopedRoundKeys.has(reportRoundKey) && reportStationKey !== stationKey) continue

      const previous = latestReportByRound.get(reportRoundKey)
      if (!previous || createdAt > previous) {
        latestReportByRound.set(reportRoundKey, createdAt)
      }
    }

    const roundCards = scopedRounds.map((round) => {
      const roundKey = String(round.name ?? round.id ?? "").trim()
      const lastReportAt = latestReportByRound.get(roundKey) ?? null
      const frequencyMinutes = getFrequencyMinutes(String(round.frequency ?? ""))
      const dueAtMs = lastReportAt ? lastReportAt.getTime() + frequencyMinutes * 60 * 1000 : null
      return normalizeRoundCard(round, dueAtMs, station.postName || station.label)
    })

    const stationNotes = notesResult.rows.filter((note) => readStationKey(note.post_name, assignedScope) === stationKey)
    const openIncidents = incidentsResult.rows.filter((incident) => {
      const incidentStatus = String(incident.status ?? "Abierto").trim().toLowerCase()
      if (incidentStatus === "cerrado") return false
      return readStationKey(incident.lugar ?? incident.location, assignedScope) === stationKey
    })

    const warnings = [
      roundsResult.error ? `rounds:${roundsResult.error}` : null,
      reportsResult.error ? `round_reports:${reportsResult.error}` : null,
      notesResult.error ? `internal_notes:${notesResult.error}` : null,
      incidentsResult.error ? `incidents:${incidentsResult.error}` : null,
    ].filter(Boolean)

    return NextResponse.json({
      roundCards,
      openNotesCount: stationNotes.length,
      recentStationNotes: stationNotes.slice(0, 3).map(normalizeRecentNote),
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