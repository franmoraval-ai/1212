"use client"

import { useMemo } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useCollection, useUser } from "@/supabase"
import { MapPin } from "lucide-react"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)

function isSameLocalDay(date: Date, now: Date) {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function toDateSafe(value: unknown) {
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === "function") {
      const d = candidate.toDate()
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function parseGpsPoint(raw: unknown): { lat: number; lng: number } | null {
  if (!raw) return null

  const parseNumber = (v: unknown) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null
    if (typeof v === "string") {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  const fromObject = (obj: Record<string, unknown>) => {
    const lat = parseNumber(obj.lat ?? obj.latitude)
    const lng = parseNumber(obj.lng ?? obj.lon ?? obj.long ?? obj.longitude)
    if (lat === null || lng === null) return null
    return { lat, lng }
  }

  if (typeof raw === "object") {
    return fromObject(raw as Record<string, unknown>)
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return fromObject(parsed)
    } catch {
      return null
    }
  }

  return null
}

export default function OverviewPage() {
  const { user } = useUser()

  const supervisionSelect = "id,created_at,gps,review_post,officer_name,status,operation_name"
  const { data: supervisions } = useCollection(user ? "supervisions" : null, {
    select: supervisionSelect,
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const incidentsSelect = "id,time,created_at,status,priority_level,title"
  const { data: incidents } = useCollection(user ? "incidents" : null, {
    select: incidentsSelect,
    orderBy: "time",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const roundsSelect = "id,created_at,status,checkpoints_total,checkpoints_completed,post_name,officer_name"
  const { data: roundReports } = useCollection(user ? "round_reports" : null, {
    select: roundsSelect,
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const todaySupervisions = useMemo(() => {
    const now = new Date()
    return (supervisions ?? []).filter((row) => {
      const d = toDateSafe(row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [supervisions])

  const todayIncidents = useMemo(() => {
    const now = new Date()
    return (incidents ?? []).filter((row) => {
      const d = toDateSafe(row.time ?? row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [incidents])

  const todayRounds = useMemo(() => {
    const now = new Date()
    return (roundReports ?? []).filter((row) => {
      const d = toDateSafe(row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [roundReports])

  const criticalIncidents = useMemo(
    () => todayIncidents.filter((i) => String(i.priorityLevel ?? "").toLowerCase() === "critical").length,
    [todayIncidents]
  )

  const welcomeOperation = useMemo(() => {
    const counts = new Map<string, number>()
    todaySupervisions.forEach((r) => {
      const op = String(r.operationName ?? "").trim()
      if (!op) return
      counts.set(op, (counts.get(op) ?? 0) + 1)
    })
    if (counts.size === 0) return "OPERACION GENERAL"
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]
  }, [todaySupervisions])

  const visitMarkers = useMemo(() => {
    return todaySupervisions
      .map((r) => {
        const gps = parseGpsPoint(r.gps)
        if (!gps) return null
        const status = String(r.status ?? "")
        return {
          lng: gps.lng,
          lat: gps.lat,
          color: status.includes("NOVEDAD") ? "#ef4444" : "#10b981",
          title: `${String(r.reviewPost ?? "Punto")} | ${String(r.officerName ?? "Oficial")}`,
        }
      })
      .filter(Boolean) as Array<{ lng: number; lat: number; color: string; title: string }>
  }, [todaySupervisions])

  const mapCenter = useMemo<[number, number]>(() => {
    if (!visitMarkers.length) return [-84.0907, 9.9281]
    const first = visitMarkers[0]
    return [first.lng, first.lat]
  }, [visitMarkers])

  return (
    <div className="p-4 md:p-10 space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Supervisiones hoy</p>
            <p className="text-3xl font-black text-white">{todaySupervisions.length}</p>
            <p className="text-xs text-white/60">Visitas reportadas en campo durante el dia.</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Incidentes hoy</p>
            <p className="text-3xl font-black text-white">{todayIncidents.length}</p>
            <p className="text-xs text-white/60">Criticos abiertos hoy: <span className="font-black text-red-400">{criticalIncidents}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Rondas hoy</p>
            <p className="text-3xl font-black text-white">{todayRounds.length}</p>
            <p className="text-xs text-white/60">Boletas ejecutadas y registradas hoy.</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Mapa simple de visitas del dia (GPS)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] rounded border border-white/10 overflow-hidden">
            <TacticalMap center={mapCenter} zoom={10} markers={visitMarkers} className="w-full h-full" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-[10px] uppercase font-black text-white/70">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Cumplim</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Con novedad</span>
            <span className="text-white/50">Total puntos GPS hoy: {visitMarkers.length}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
