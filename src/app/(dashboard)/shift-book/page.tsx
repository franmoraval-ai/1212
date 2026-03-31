"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookText, Loader2, RefreshCcw } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSupabase, useUser } from "@/supabase"
import { useStationShift } from "@/components/layout/station-shift-provider"
import { resolveStationReference } from "@/lib/stations"

type ShiftHistoryEntry = {
  id: string
  stationLabel: string
  stationPostName: string
  officerUserId: string
  officerName: string
  officerEmail: string
  checkInAt: string | null
  checkOutAt: string | null
  workedMinutes: number
  notes: string
  createdByDeviceEmail: string
  createdAt: string | null
  isOpen: boolean
}

function formatShiftDuration(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null
  const start = new Date(startedAt)
  const end = new Date(endedAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null

  const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function formatWorkedMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min"
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

export default function ShiftBookPage() {
  const { supabase } = useSupabase()
  const { user, isUserLoading } = useUser()
  const { stationLabel, stationPostName } = useStationShift()
  const defaultStation = useMemo(() => resolveStationReference({ assigned: user?.assigned, stationLabel: stationPostName || stationLabel }), [stationLabel, stationPostName, user?.assigned])
  const [selectedStation, setSelectedStation] = useState(stationPostName || stationLabel || "")
  const [history, setHistory] = useState<ShiftHistoryEntry[]>([])
  const [activeShift, setActiveShift] = useState<ShiftHistoryEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const nextStation = stationPostName || stationLabel || defaultStation.postName
    if (!nextStation) return
    setSelectedStation((current) => current || nextStation)
  }, [defaultStation.postName, stationLabel, stationPostName])

  const getAuthHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = String(sessionData.session?.access_token ?? "").trim()
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = String(refreshed.session?.access_token ?? "").trim()
    }
    return {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }
  }, [supabase])

  const loadHistory = useCallback(async () => {
    if (!selectedStation.trim()) return
    setLoading(true)
    try {
      const headers = await getAuthHeaders()
      const canonicalStation = resolveStationReference({ assigned: user?.assigned, stationLabel: selectedStation.trim() })
      const response = await fetch(`/api/shifts?stationLabel=${encodeURIComponent(canonicalStation.postName)}&stationPostName=${encodeURIComponent(canonicalStation.postName)}`, {
        method: "GET",
        headers,
        credentials: "include",
      })
      const data = (await response.json()) as { history?: ShiftHistoryEntry[]; activeShift?: ShiftHistoryEntry | null; message?: string | null; error?: string }
      if (!response.ok) {
        setMessage(String(data.error ?? "No se pudo cargar el libro de turno."))
        return
      }
      setHistory(Array.isArray(data.history) ? data.history : [])
      setActiveShift(data.activeShift ?? null)
      setMessage(data.message ?? null)
    } catch {
      setMessage("No se pudo cargar el libro de turno.")
    } finally {
      setLoading(false)
    }
  }, [getAuthHeaders, selectedStation, user?.assigned])

  useEffect(() => {
    if (!selectedStation.trim()) return
    void loadHistory()
  }, [loadHistory, selectedStation])

  const latestEntry = useMemo(() => history[0] ?? null, [history])
  const notedEntries = useMemo(() => history.filter((entry) => entry.notes.trim()), [history])
  const latestNote = useMemo(() => notedEntries[0] ?? null, [notedEntries])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-6xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">LIBRO DE TURNO</h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">Historial de entrada y salida por puesto.</p>
        </div>
        <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 gap-2" onClick={() => void loadHistory()} disabled={loading || !selectedStation.trim()}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />} Refrescar
        </Button>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Puesto</CardTitle>
          <CardDescription className="text-white/60 text-xs">Use el puesto fijo del dispositivo o consulte otro puesto manualmente.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Puesto consultado</Label>
            <Input value={selectedStation} onChange={(event) => setSelectedStation(event.target.value)} className="bg-black/30 border-white/10 text-white" placeholder="Ej: Puesto Norte" />
          </div>
          <Button type="button" className="bg-primary text-black font-black uppercase" onClick={() => void loadHistory()} disabled={!selectedStation.trim() || loading}>Consultar</Button>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Turno actual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeShift ? (
              <>
                <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3">
                  <p className="text-[10px] uppercase font-black text-cyan-200">Oficial activo</p>
                  <p className="text-lg font-black uppercase text-white">{activeShift.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">{activeShift.checkInAt ? new Date(activeShift.checkInAt).toLocaleString() : "Sin fecha"}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Estado</p>
                  <p className="text-sm font-black uppercase text-white">En turno</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Observación</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{activeShift.notes || "Sin observación registrada."}</p>
                </div>
              </>
            ) : latestEntry ? (
              <>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Último turno</p>
                  <p className="text-lg font-black uppercase text-white">{latestEntry.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">{latestEntry.checkOutAt ? new Date(latestEntry.checkOutAt).toLocaleString() : "Sin cierre"}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Duración</p>
                  <p className="text-sm font-black uppercase text-white">{formatShiftDuration(latestEntry.checkInAt, latestEntry.checkOutAt) || formatWorkedMinutes(latestEntry.workedMinutes)}</p>
                </div>
              </>
            ) : (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">Sin turnos registrados.</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Turnos</p>
                <p className="text-xl font-black text-white">{history.length}</p>
              </div>
              <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3">
                <p className="text-[10px] uppercase font-black text-amber-100">Con observación</p>
                <p className="text-xl font-black text-white">{notedEntries.length}</p>
              </div>
            </div>
            {latestNote ? (
              <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3 space-y-1">
                <p className="text-[10px] uppercase font-black text-amber-100">Observación reciente</p>
                <p className="text-[11px] uppercase text-white/70">{latestNote.officerName} dejó novedad en su turno.</p>
                <p className="text-sm text-white whitespace-pre-wrap">{latestNote.notes}</p>
              </div>
            ) : null}
            {message ? <p className="text-[10px] uppercase text-amber-300 font-black">{message}</p> : null}
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2"><BookText className="w-4 h-4 text-primary" /> Historial de asistencia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="h-32 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : history.length === 0 ? (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">Sin marcaciones para este puesto.</div>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-black uppercase text-white">{entry.officerName}</p>
                      <p className="text-[10px] uppercase text-white/55">{entry.checkInAt ? new Date(entry.checkInAt).toLocaleString() : "Sin fecha"}</p>
                    </div>
                    <span className="text-[10px] uppercase font-black text-cyan-300">{entry.isOpen ? "EN TURNO" : "CERRADO"}</span>
                  </div>
                  <p className="text-[10px] uppercase text-white/60">Entrada: {entry.checkInAt ? new Date(entry.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Sin dato"}</p>
                  <p className="text-[10px] uppercase text-white/45">Salida: {entry.checkOutAt ? new Date(entry.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Turno abierto"}</p>
                  <p className="text-[10px] uppercase text-white/45">Duración: {formatShiftDuration(entry.checkInAt, entry.checkOutAt) || formatWorkedMinutes(entry.workedMinutes)}</p>
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase font-black text-white/50">Observaciones del turno</p>
                    <p className="text-sm text-white whitespace-pre-wrap">{entry.notes || "Sin observación reportada."}</p>
                  </div>
                  <p className="text-[10px] uppercase text-white/40">Dispositivo: {entry.createdByDeviceEmail || "Sin dato"}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}