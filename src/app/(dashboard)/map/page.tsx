"use client"

import { useEffect } from "react"
import { useMemo } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useRoundsContext } from "@/hooks/use-rounds-context"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)
import { useUser } from "@/supabase"
import { useStationShift } from "@/components/layout/station-shift-provider"
import { resolveStationReference } from "@/lib/stations"
import { Crosshair, Route, ShieldAlert } from "lucide-react"

type RoundCheckpoint = {
  name?: string
  lat?: number
  lng?: number
}

type RoundRow = {
  id: string
  name?: string
  post?: string
  status?: string
  checkpoints?: RoundCheckpoint[]
}

type ReactionMarker = {
  lng: number
  lat: number
  color: string
  title: string
  kind: "start" | "critical" | "standard"
  roundName: string
  checkpointName: string
}

const CRITICAL_POINT_KEYWORDS = [
  "porton",
  "acceso",
  "entrada",
  "salida",
  "garita",
  "perimetro",
  "alarma",
  "cctv",
  "camara",
  "bomba",
  "electrico",
  "generador",
  "tablero",
  "arma",
  "armeria",
  "emergencia",
  "evacuacion",
]

function resolveReactionPointKind(name: string, index: number): ReactionMarker["kind"] {
  if (index === 0) return "start"

  const normalized = name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  if (CRITICAL_POINT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "critical"
  }

  return "standard"
}

function getReactionPointColor(kind: ReactionMarker["kind"]) {
  if (kind === "start") return "#22c55e"
  if (kind === "critical") return "#ef4444"
  return "#f59e0b"
}

function getReactionPointLabel(kind: ReactionMarker["kind"]) {
  if (kind === "start") return "Inicio"
  if (kind === "critical") return "Critico"
  return "Referencia"
}

function buildAverageCenter(markers: Array<{ lng: number; lat: number }>) {
  if (markers.length === 0) return [-84.0907, 9.9281] as [number, number]
  const totals = markers.reduce((acc, marker) => ({ lng: acc.lng + marker.lng, lat: acc.lat + marker.lat }), { lng: 0, lat: 0 })
  return [totals.lng / markers.length, totals.lat / markers.length] as [number, number]
}

export default function ReactionPointsPage() {
  // Load Mapbox CSS only when map page is mounted
  useEffect(() => {
    const id = "mapbox-gl-css"
    if (document.getElementById(id)) return
    const link = document.createElement("link")
    link.id = id
    link.rel = "stylesheet"
    link.href = "https://api.mapbox.com/mapbox-gl-js/v3.1.2/mapbox-gl.css"
    document.head.appendChild(link)
  }, [])

  const { user } = useUser()
  const {
    stationLabel,
    stationPostName,
    stationOperationName,
    stationProfileRegistered,
    stationProfileEnabled,
    stationDeviceLabel,
    stationProfileNotes,
  } = useStationShift()
  const roleLevel = Number(user?.roleLevel ?? 1)
  const activeStation = resolveStationReference({ stationLabel: stationPostName || stationLabel })
  const stationScopeTokens = useMemo(
    () => [stationOperationName, stationPostName, stationLabel]
      .flatMap((value) => String(value ?? "").split(/[|,;\-]/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
    [stationLabel, stationOperationName, stationPostName]
  )

  const { rounds } = useRoundsContext()
  const roundRows = useMemo(() => rounds as RoundRow[], [rounds])

  const visibleRounds = useMemo(() => {
    const source = roundRows ?? []
    if (roleLevel >= 2) return source
    if (stationScopeTokens.length === 0) return []

    return source.filter((round) => {
      const haystack = `${String(round.name ?? "")} ${String(round.post ?? "")}`.toLowerCase()
      return stationScopeTokens.some((token) => haystack.includes(token))
    })
  }, [roleLevel, roundRows, stationScopeTokens])

  const reactionMarkers = useMemo(() => {
    return visibleRounds.flatMap((round) => {
      return (round.checkpoints ?? [])
        .map((checkpoint, index) => {
          const lat = Number(checkpoint.lat)
          const lng = Number(checkpoint.lng)
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

          const checkpointName = String(checkpoint.name ?? `Punto ${index + 1}`).trim() || `Punto ${index + 1}`
          const kind = resolveReactionPointKind(checkpointName, index)
          const roundName = String(round.name ?? "Ronda").trim() || "Ronda"

          return {
            lng,
            lat,
            color: getReactionPointColor(kind),
            title: `${roundName} · ${checkpointName}`,
            kind,
            roundName,
            checkpointName,
          }
        })
        .filter(Boolean)
    }).filter(Boolean) as ReactionMarker[]
  }, [visibleRounds])

  const markerSummary = useMemo(() => {
    return reactionMarkers.reduce(
      (acc, marker) => {
        acc[marker.kind] += 1
        return acc
      },
      { start: 0, critical: 0, standard: 0 }
    )
  }, [reactionMarkers])

  const mapCenter = useMemo(() => buildAverageCenter(reactionMarkers), [reactionMarkers])

  return (
    <div className="p-4 sm:p-6 md:p-10 space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">Puntos de Reaccion</h1>
          <p className="text-white/60 text-xs md:text-sm uppercase tracking-wide">
            {roleLevel <= 1 ? `${stationPostName || stationLabel || "Puesto operativo sin contexto"} · Referencia visual de checkpoints y puntos operativos.` : "Vista rapida de checkpoints con coordenadas configuradas."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" className="border-white/15 text-white hover:bg-white/10">
            <Link href="/rounds">Abrir rondas</Link>
          </Button>
          <Button asChild className="bg-primary text-black font-black">
            <Link href="/incidents/report">Reportar novedad</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-widest text-white/45">Rondas visibles</CardDescription>
            <CardTitle className="text-3xl font-black text-white">{visibleRounds.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-widest text-white/45">Puntos con GPS</CardDescription>
            <CardTitle className="text-3xl font-black text-white">{reactionMarkers.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-widest text-white/45">Cobertura</CardDescription>
            <CardTitle className="text-sm font-black uppercase text-white">{roleLevel <= 1 ? (stationPostName || stationLabel || "Puesto operativo sin contexto") : "Operacion completa"}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-widest text-white/45">Inicios</CardDescription>
            <CardTitle className="text-3xl font-black text-emerald-400">{markerSummary.start}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader className="pb-2">
            <CardDescription className="text-[10px] uppercase tracking-widest text-white/45">Criticos</CardDescription>
            <CardTitle className="text-3xl font-black text-red-400">{markerSummary.critical}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {roleLevel <= 1 ? (
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Estado operativo del puesto</CardTitle>
            <CardDescription className="text-white/60 text-xs">Esta vista sigue el puesto operativo actual del dispositivo.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded border border-white/10 bg-black/20 p-3 space-y-1">
              <p className="text-[10px] uppercase font-black text-white/50">Puesto</p>
              <p className="text-sm font-black uppercase text-white">{stationPostName || stationLabel || "Puesto operativo sin contexto"}</p>
              <p className="text-[10px] uppercase text-white/45">
                {stationProfileRegistered
                  ? stationProfileEnabled
                    ? "L1 operativo habilitado"
                    : "L1 operativo pausado"
                  : "Pendiente de registro en L1 operativo"}
              </p>
              {stationDeviceLabel ? <p className="text-[10px] uppercase text-cyan-200">Dispositivo: {stationDeviceLabel}</p> : null}
              {stationProfileNotes ? <p className="text-[11px] text-white/60">{stationProfileNotes}</p> : null}
            </div>
            {!stationProfileRegistered ? (
              <div className="rounded border border-amber-400/20 bg-amber-400/10 p-3 text-[10px] uppercase font-black text-amber-200">
                Este puesto todavía no está registrado en L1 operativo. El mapa sigue visible como referencia, pero el turno debe activarse desde Centro Operativo.
              </div>
            ) : null}
            {stationProfileRegistered && !stationProfileEnabled ? (
              <div className="rounded border border-amber-400/20 bg-amber-400/10 p-3 text-[10px] uppercase font-black text-amber-200">
                Este puesto está pausado para L1 operativo. Use el mapa solo como consulta hasta que Centro Operativo lo reactive.
              </div>
            ) : null}
            {!activeStation.key || stationScopeTokens.length === 0 ? (
              <div className="rounded border border-amber-400/20 bg-amber-400/10 p-3 text-[10px] uppercase font-black text-amber-200">
                Este dispositivo todavía no tiene contexto operativo suficiente para filtrar rondas del mapa por puesto.
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_360px] gap-6">
        <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
          <CardHeader>
            <CardTitle className="text-white font-black uppercase tracking-wide flex items-center gap-2">
              <Crosshair className="w-4 h-4 text-primary" />
              Mapa operativo
            </CardTitle>
            <CardDescription className="text-white/55">
              {reactionMarkers.length > 0 ? "Use este mapa como referencia rapida para reaccion, cobertura y ubicacion de checkpoints." : "Aun no hay checkpoints con coordenadas para mostrar en el mapa."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 mb-4 text-[10px] uppercase font-black tracking-widest">
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-emerald-300">Inicio</span>
              <span className="rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1 text-red-300">Critico</span>
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-amber-300">Referencia</span>
            </div>
            <TacticalMap center={mapCenter} zoom={13} markers={reactionMarkers} interactive className="w-full h-[55vh] min-h-[360px]" />
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-white font-black uppercase tracking-wide flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              Puntos listados
            </CardTitle>
            <CardDescription className="text-white/55">Checkpoints con GPS configurado para reaccion o referencia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {reactionMarkers.length > 0 ? reactionMarkers.map((marker) => (
              <div key={`${marker.title}-${marker.lat}-${marker.lng}`} className="rounded border border-white/10 bg-white/[0.03] p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[11px] font-black uppercase text-white">{marker.title}</p>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-widest ${marker.kind === "start" ? "bg-emerald-400/10 text-emerald-300" : marker.kind === "critical" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}>
                    {getReactionPointLabel(marker.kind)}
                  </span>
                </div>
                <p className="text-[10px] uppercase text-white/50">{marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}</p>
              </div>
            )) : (
              <div className="rounded border border-amber-400/20 bg-amber-400/10 p-4 space-y-2">
                <p className="text-[11px] font-black uppercase text-amber-200 flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" />
                  Sin puntos con GPS
                </p>
                <p className="text-[10px] uppercase text-amber-100/70">Asigne coordenadas a checkpoints desde creación o edición de rondas para que aquí aparezcan los puntos de reacción.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
