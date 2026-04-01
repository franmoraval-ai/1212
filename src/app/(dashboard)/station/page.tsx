"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, BookText, ClipboardCheck, Loader2, Route, ShieldCheck, Siren, UserRound } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useStationShift } from "@/components/layout/station-shift-provider"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { resolveStationReference } from "@/lib/stations"

type RoundRow = {
  id: string
  name?: string
  post?: string
  status?: string
  frequency?: string
}

type RoundReportRow = {
  id: string
  roundId?: string
  round_id?: string
  roundName?: string
  round_name?: string
  createdAt?: string
  created_at?: string
}

type InternalNoteRow = {
  id: string
  status?: string
  priority?: string
  detail?: string
  reportedByName?: string
  reported_by_name?: string
  postName?: string
  post_name?: string
  createdAt?: string
  created_at?: string
}

type IncidentRow = {
  id: string
  status?: string
  priorityLevel?: string
  priority_level?: string
  incidentType?: string
  incident_type?: string
  description?: string
  location?: string
  lugar?: string
  time?: string
  createdAt?: string
  created_at?: string
}

function toDateSafe(value: unknown) {
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === "function") {
      const parsed = candidate.toDate()
      if (!Number.isNaN(parsed.getTime())) return parsed
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value)
    if (!Number.isNaN(parsed.getTime())) return parsed
  }
  return null
}

function formatDateTime(value: unknown) {
  const parsed = toDateSafe(value)
  if (!parsed) return "Sin registro"
  return parsed.toLocaleString()
}

function formatDueWindow(dueAtMs: number | null) {
  if (dueAtMs == null) return "Primera ejecución pendiente"
  const diffMinutes = Math.round((dueAtMs - Date.now()) / 60000)
  if (diffMinutes <= 0) return `Vencida hace ${Math.abs(diffMinutes)} min`
  if (diffMinutes < 60) return `Vence en ${diffMinutes} min`
  const hours = Math.floor(diffMinutes / 60)
  const minutes = diffMinutes % 60
  return `Vence en ${hours}h ${minutes}m`
}

function getFrequencyMinutes(value: string) {
  const normalized = String(value ?? "").toLowerCase()
  const numeric = Number.parseInt(normalized.replace(/[^0-9]/g, ""), 10)
  if (normalized.includes("hora")) return Number.isFinite(numeric) && numeric > 0 ? numeric * 60 : 60
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  return 30
}

function getReportCreatedDate(report: RoundReportRow) {
  const raw = report.createdAt ?? report.created_at
  if (!raw) return null
  const parsed = new Date(String(raw))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function getReportRoundKey(report: RoundReportRow) {
  return String(report.roundName ?? report.round_name ?? report.roundId ?? report.round_id ?? "").trim()
}

function tokenizeScope(...values: Array<unknown>) {
  return values
    .flatMap((value) => String(value ?? "").split(/[|,;\-]/))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

export default function StationWorkspacePage() {
  const { user } = useSupabase()
  const { isUserLoading } = useUser()
  const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now())
  const {
    enabled: stationModeEnabled,
    stationOperationName,
    stationPostName,
    stationLabel,
    activeOfficerName,
    shiftStartedAt,
    openShiftDialog,
    shiftHistory,
    attendanceModeAvailable,
  } = useStationShift()

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentTimestamp(Date.now())
    }, 60000)

    return () => window.clearInterval(timer)
  }, [])

  const roleLevel = Number(user?.roleLevel ?? 1)
  const isL1Operator = roleLevel <= 1

  const { data: roundsData, isLoading: roundsLoading } = useCollection<RoundRow>(
    user ? "rounds" : null,
    { orderBy: "name", orderDesc: false }
  )
  const { data: reportsData } = useCollection<RoundReportRow>(
    user ? "round_reports" : null,
    { orderBy: "created_at", orderDesc: true, realtime: false, pollingMs: 60000 }
  )
  const { data: notesData } = useCollection<InternalNoteRow>(
    user ? "internal_notes" : null,
    { orderBy: "created_at", orderDesc: true, realtime: false, pollingMs: 60000 }
  )
  const { data: incidentsData } = useCollection<IncidentRow>(
    user ? "incidents" : null,
    { orderBy: "time", orderDesc: true, realtime: false, pollingMs: 60000 }
  )

  const stationReference = useMemo(
    () => resolveStationReference({ stationLabel: stationPostName ?? stationLabel }),
    [stationLabel, stationPostName]
  )

  const stationScopeTokens = useMemo(
    () => tokenizeScope(stationOperationName, stationPostName, stationLabel),
    [stationLabel, stationOperationName, stationPostName]
  )

  const scopedRounds = useMemo(() => {
    const rounds = roundsData ?? []
    if (stationScopeTokens.length === 0) return rounds.filter((round) => String(round.status ?? "").trim().toLowerCase() === "activa")

    return rounds.filter((round) => {
      if (String(round.status ?? "").trim().toLowerCase() !== "activa") return false
      const haystack = `${String(round.name ?? "")} ${String(round.post ?? "")}`.toLowerCase()
      return stationScopeTokens.some((token) => haystack.includes(token))
    })
  }, [roundsData, stationScopeTokens])

  const latestReportByRound = useMemo(() => {
    const map = new Map<string, Date>()
    for (const report of reportsData ?? []) {
      const key = getReportRoundKey(report)
      const createdAt = getReportCreatedDate(report)
      if (!key || !createdAt) continue
      const previous = map.get(key)
      if (!previous || createdAt > previous) map.set(key, createdAt)
    }
    return map
  }, [reportsData])

  const roundCards = useMemo(() => {
    return scopedRounds.map((round) => {
      const roundKey = String(round.name ?? round.id ?? "").trim()
      const lastReportAt = latestReportByRound.get(roundKey) ?? null
      const frequencyMinutes = getFrequencyMinutes(String(round.frequency ?? ""))
      const dueAtMs = lastReportAt ? lastReportAt.getTime() + frequencyMinutes * 60 * 1000 : null
      let status: "Pendiente" | "En tiempo" | "Por vencer" | "Vencida" = "Pendiente"

      if (dueAtMs == null) status = "Pendiente"
      else if (currentTimestamp >= dueAtMs) status = "Vencida"
      else if (dueAtMs - currentTimestamp <= 10 * 60 * 1000) status = "Por vencer"
      else status = "En tiempo"

      return {
        id: String(round.id),
        name: String(round.name ?? "Ronda"),
        post: String(round.post ?? stationPostName ?? stationLabel ?? "Puesto"),
        status,
        dueAtMs,
      }
    })
  }, [currentTimestamp, latestReportByRound, scopedRounds, stationLabel, stationPostName])

  const openNotesCount = useMemo(() => {
    return (notesData ?? []).filter((note) => {
      const noteStatus = String(note.status ?? "abierta").trim().toLowerCase()
      if (noteStatus === "resuelta") return false
      const notePost = String(note.postName ?? note.post_name ?? "").trim()
      if (!stationReference.key) return true
      return resolveStationReference({ stationLabel: notePost }).key === stationReference.key
    }).length
  }, [notesData, stationReference.key])

  const stationNotes = useMemo(
    () => (notesData ?? []).filter((note) => {
      const notePost = String(note.postName ?? note.post_name ?? "").trim()
      if (!notePost || !stationReference.key) return false
      return resolveStationReference({ stationLabel: notePost }).key === stationReference.key
    }),
    [notesData, stationReference.key]
  )

  const openIncidents = useMemo(() => {
    return (incidentsData ?? []).filter((incident) => {
      const status = String(incident.status ?? "Abierto").trim().toLowerCase()
      if (status === "cerrado") return false
      const incidentPlace = String(incident.lugar ?? incident.location ?? "").trim()
      if (!incidentPlace || !stationReference.key) return false
      return resolveStationReference({ stationLabel: incidentPlace }).key === stationReference.key
    })
  }, [incidentsData, stationReference.key])

  const recentStationNotes = useMemo(() => stationNotes.slice(0, 3), [stationNotes])
  const recentStationIncidents = useMemo(
    () => openIncidents.slice(0, 3),
    [openIncidents]
  )

  const nextCriticalRound = useMemo(() => {
    if (roundCards.length === 0) return null
    const rank = (status: string) => {
      if (status === "Vencida") return 0
      if (status === "Pendiente") return 1
      if (status === "Por vencer") return 2
      return 3
    }

    return [...roundCards].sort((left, right) => {
      const byStatus = rank(left.status) - rank(right.status)
      if (byStatus !== 0) return byStatus
      const leftDue = left.dueAtMs ?? Number.MIN_SAFE_INTEGER
      const rightDue = right.dueAtMs ?? Number.MIN_SAFE_INTEGER
      return leftDue - rightDue
    })[0] ?? null
  }, [roundCards])

  const latestShift = useMemo(() => shiftHistory[0] ?? null, [shiftHistory])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">PUESTO ACTIVO</h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Centro operativo del puesto para ejecutar rondas, novedades y control del turno.
          </p>
        </div>
        {isL1Operator ? (
          <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={openShiftDialog}>
            <UserRound className="w-4 h-4 mr-2" /> {activeOfficerName ? "Cambiar turno" : "Abrir turno"}
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Estado del puesto</CardTitle>
            <CardDescription className="text-white/60 text-xs">Identidad operativa actual del dispositivo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3 space-y-1">
              <p className="text-[10px] uppercase font-black text-cyan-200">Operación</p>
              <p className="text-sm font-black uppercase text-white">{stationOperationName || "Sin operación"}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-3 space-y-1">
              <p className="text-[10px] uppercase font-black text-white/50">Puesto</p>
              <p className="text-lg font-black uppercase text-white">{stationPostName || stationLabel || "Sin puesto"}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/20 p-3 space-y-1">
              <p className="text-[10px] uppercase font-black text-white/50">Oficial en turno</p>
              <p className="text-sm font-black uppercase text-white">{activeOfficerName || "Sin oficial activo"}</p>
              <p className="text-[10px] uppercase text-white/45">{shiftStartedAt ? `Desde ${new Date(shiftStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Abra turno para operar"}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Rondas activas</p>
                <p className="text-2xl font-black text-white">{roundCards.length}</p>
              </div>
              <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3">
                <p className="text-[10px] uppercase font-black text-amber-100">Novedades abiertas</p>
                <p className="text-2xl font-black text-white">{openNotesCount}</p>
              </div>
            </div>
            <div className="rounded border border-red-500/20 bg-red-500/10 p-3">
              <p className="text-[10px] uppercase font-black text-red-200">Incidentes abiertos</p>
              <p className="text-2xl font-black text-white">{openIncidents.length}</p>
            </div>
            {nextCriticalRound ? (
              <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3 space-y-1">
                <p className="text-[10px] uppercase font-black text-cyan-200">Siguiente ronda crítica</p>
                <p className="text-sm font-black uppercase text-white">{nextCriticalRound.name}</p>
                <p className="text-[10px] uppercase text-cyan-100/80">{formatDueWindow(nextCriticalRound.dueAtMs)}</p>
              </div>
            ) : null}
            {!stationModeEnabled ? (
              <p className="text-[10px] uppercase font-black text-amber-300">Este dispositivo aún no tiene modo puesto definido. Configure el turno operativo para anclar contexto.</p>
            ) : null}
            {!attendanceModeAvailable ? (
              <p className="text-[10px] uppercase font-black text-amber-300">El control de turnos no está disponible hasta aplicar el esquema de asistencia.</p>
            ) : null}
            {!activeOfficerName ? (
              <div className="rounded border border-red-500/20 bg-red-500/10 p-3 text-[10px] uppercase font-black text-red-200">
                El puesto no tiene oficial activo. Defina el turno antes de operar.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Acciones del puesto</CardTitle>
              <CardDescription className="text-white/60 text-xs">Entrada principal para ejecutar labores L1 desde el puesto.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
              <Button asChild className="h-auto min-h-24 bg-primary text-black font-black uppercase justify-start px-4 py-4">
                <Link href="/rounds">
                  <div className="flex flex-col items-start gap-2">
                    <Route className="w-5 h-5" />
                    <div>
                      <p>Rondas</p>
                      <p className="text-[10px] font-bold opacity-70">Ejecutar boletas del puesto</p>
                    </div>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto min-h-24 border-white/10 text-white hover:bg-white/10 justify-start px-4 py-4">
                <Link href="/internal-notes">
                  <div className="flex flex-col items-start gap-2">
                    <ClipboardCheck className="w-5 h-5" />
                    <div>
                      <p className="font-black uppercase">Novedades</p>
                      <p className="text-[10px] font-bold text-white/60">Registrar faltantes y observaciones</p>
                    </div>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto min-h-24 border-white/10 text-white hover:bg-white/10 justify-start px-4 py-4">
                <Link href="/incidents/report">
                  <div className="flex flex-col items-start gap-2">
                    <AlertTriangle className="w-5 h-5" />
                    <div>
                      <p className="font-black uppercase">Incidente</p>
                      <p className="text-[10px] font-bold text-white/60">Escalar una novedad crítica</p>
                    </div>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-auto min-h-24 border-white/10 text-white hover:bg-white/10 justify-start px-4 py-4">
                <Link href="/shift-book">
                  <div className="flex flex-col items-start gap-2">
                    <BookText className="w-5 h-5" />
                    <div>
                      <p className="font-black uppercase">Libro de turno</p>
                      <p className="text-[10px] font-bold text-white/60">Ver historial del puesto</p>
                    </div>
                  </div>
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Rondas del puesto</CardTitle>
              <CardDescription className="text-white/60 text-xs">Solo rondas activas vinculadas operativamente a este puesto.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {roundsLoading ? (
                <div className="h-32 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
              ) : roundCards.length === 0 ? (
                <div className="rounded border border-white/10 bg-black/20 p-4 text-[11px] uppercase text-white/55">
                  No hay rondas activas reconocidas para este puesto todavía.
                </div>
              ) : (
                roundCards.map((round) => (
                  <div key={round.id} className="rounded border border-white/10 bg-black/20 p-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div>
                      <p className="text-sm font-black uppercase text-white">{round.name}</p>
                      <p className="text-[10px] uppercase text-white/55">{round.post}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-full ${round.status === "Vencida" ? "bg-red-500/15 text-red-300" : round.status === "Por vencer" ? "bg-amber-400/15 text-amber-200" : round.status === "En tiempo" ? "bg-cyan-400/15 text-cyan-200" : "bg-white/10 text-white/60"}`}>
                        {round.status}
                      </span>
                      <Button asChild variant="outline" className="border-white/10 text-white hover:bg-white/10">
                        <Link href={`/rounds?roundId=${encodeURIComponent(round.id)}`}>
                          <ShieldCheck className="w-4 h-4 mr-2" /> Abrir
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Pulso operativo</CardTitle>
              <CardDescription className="text-white/60 text-xs">Última actividad real del puesto: novedades e incidentes todavía abiertos.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase font-black text-white/50">Novedades recientes</p>
                  <Button asChild variant="ghost" className="h-7 px-2 text-[10px] uppercase text-white/60 hover:bg-white/10 hover:text-white">
                    <Link href="/internal-notes">Ver todas</Link>
                  </Button>
                </div>
                {recentStationNotes.length === 0 ? (
                  <div className="rounded border border-white/10 bg-black/20 p-4 text-[11px] uppercase text-white/55">Sin novedades abiertas en este puesto.</div>
                ) : (
                  recentStationNotes.map((note) => (
                    <div key={note.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase text-white">{note.priority ?? "media"}</p>
                        <p className="text-[10px] uppercase text-white/45">{formatDateTime(note.createdAt ?? note.created_at)}</p>
                      </div>
                      <p className="text-xs text-white/80 line-clamp-2">{note.detail || "Sin detalle registrado"}</p>
                      <p className="text-[10px] uppercase text-white/45">Reporta: {note.reportedByName ?? note.reported_by_name ?? "Operador"}</p>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase font-black text-white/50">Incidentes abiertos</p>
                  <Button asChild variant="ghost" className="h-7 px-2 text-[10px] uppercase text-white/60 hover:bg-white/10 hover:text-white">
                    <Link href="/incidents">Ver tablero</Link>
                  </Button>
                </div>
                {recentStationIncidents.length === 0 ? (
                  <div className="rounded border border-white/10 bg-black/20 p-4 text-[11px] uppercase text-white/55">Sin incidentes abiertos en este puesto.</div>
                ) : (
                  recentStationIncidents.map((incident) => (
                    <div key={incident.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-1">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-[11px] font-black uppercase text-white">{incident.incidentType ?? incident.incident_type ?? "Incidente"}</p>
                        <span className="inline-flex items-center gap-1 text-[10px] uppercase font-black text-red-200">
                          <Siren className="w-3.5 h-3.5" /> {incident.priorityLevel ?? incident.priority_level ?? "Medium"}
                        </span>
                      </div>
                      <p className="text-xs text-white/80 line-clamp-2">{incident.description || "Sin descripción registrada"}</p>
                      <p className="text-[10px] uppercase text-white/45">{String(incident.lugar ?? incident.location ?? stationReference.label ?? "Puesto")}</p>
                      <p className="text-[10px] uppercase text-white/45">{formatDateTime(incident.time ?? incident.createdAt ?? incident.created_at)}</p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Turno reciente</CardTitle>
            </CardHeader>
            <CardContent>
              {latestShift ? (
                <div className="rounded border border-white/10 bg-black/20 p-4 space-y-2">
                  <p className="text-sm font-black uppercase text-white">{latestShift.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">Entrada: {formatDateTime(latestShift.checkInAt)}</p>
                  <p className="text-[10px] uppercase text-white/45">Salida: {latestShift.checkOutAt ? formatDateTime(latestShift.checkOutAt) : "Turno abierto"}</p>
                </div>
              ) : (
                <div className="rounded border border-white/10 bg-black/20 p-4 text-[11px] uppercase text-white/55">
                  Sin historial reciente del puesto.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}