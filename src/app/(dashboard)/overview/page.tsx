"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  ShieldAlert, 
  ClipboardCheck, 
  Globe,
  Plus,
  Route,
  X,
  Radio,
  Zap,
  AlertTriangle,
  BarChart3
} from "lucide-react"
import { useCollection, useUser } from "@/supabase"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { TacticalMap } from "@/components/ui/tactical-map"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"

export default function OverviewPage() {
  const { user, isUserLoading } = useUser()
  const [isExpanded, setIsExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const { data: rounds } = useCollection(user ? "rounds" : null)
  const { data: incidents } = useCollection(user ? "incidents" : null)
  const { data: reports } = useCollection(user ? "supervisions" : null)
  const { data: weapons } = useCollection(user ? "weapons" : null)
  const { data: alerts } = useCollection(user ? "alerts" : null, { orderBy: "created_at", orderDesc: true })
  const { data: puestos } = useCollection(user ? "puestos" : null)
  const { data: personnel } = useCollection(user ? "users" : null)

  const incidentsByPriority = (() => {
    if (!incidents?.length) return []
    const counts: Record<string, number> = { Critical: 0, High: 0, Medium: 0, Low: 0 }
    incidents.forEach((i) => {
      const p = String(i.priorityLevel || "Low")
      if (p in counts) counts[p]++
      else counts.Low++
    })
    return Object.entries(counts).map(([name, count]) => ({ name, count }))
  })()

  const criticalOpen = incidents?.filter((i) => (i.priorityLevel === "Critical") && (i.status !== "Cerrado")).length ?? 0
  const recentAlerts = (alerts ?? []).slice(0, 5)

  if (!mounted || isUserLoading) {
    return (
      <div className="min-h-screen bg-[#030303] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] font-black text-primary uppercase tracking-widest">Sincronizando Mando...</span>
        </div>
      </div>
    )
  }

  const officerMarkers = (() => {
    const markers: Array<{ lng: number; lat: number; title: string; color: string }> = []
    const seen = new Set<string>()

    // Ubicaciones reportadas directamente en supervisiones.
    reports?.forEach((r) => {
      const gps = (r.gps as { lat?: number; lng?: number } | null | undefined) ?? null
      if (typeof gps?.lat !== "number" || typeof gps?.lng !== "number") return

      const officerName = String(r.officerName ?? "Oficial")
      const key = `gps:${officerName}:${gps.lat.toFixed(5)}:${gps.lng.toFixed(5)}`
      if (seen.has(key)) return
      seen.add(key)

      markers.push({
        lng: gps.lng,
        lat: gps.lat,
        title: `Oficial: ${officerName}`,
        color: "#06b6d4"
      })
    })

    // Respaldo: oficiales activos ubicados en el puesto asignado.
    const puestosByName = new Map<string, { lat: number; lng: number; displayName: string }>()
    puestos?.forEach((p) => {
      const key = String(p.name ?? "").trim().toLowerCase()
      if (!key) return
      puestosByName.set(key, {
        lat: Number(p.lat ?? 9.92),
        lng: Number(p.lng ?? -84.09),
        displayName: String(p.name ?? "Puesto")
      })
    })

    personnel?.forEach((u) => {
      const assignedKey = String(u.assigned ?? "").trim().toLowerCase()
      if (!assignedKey) return

      const assignedPost = puestosByName.get(assignedKey)
      if (!assignedPost) return

      const status = String(u.status ?? "").toLowerCase()
      if (status && status !== "activo") return

      const officerName = String(u.firstName ?? u.email ?? "Oficial")
      const key = `assigned:${officerName}:${assignedPost.lat.toFixed(5)}:${assignedPost.lng.toFixed(5)}`
      if (seen.has(key)) return
      seen.add(key)

      markers.push({
        lng: assignedPost.lng,
        lat: assignedPost.lat,
        title: `Oficial asignado: ${officerName} (${assignedPost.displayName})`,
        color: "#22d3ee"
      })
    })

    return markers
  })()

  const tacticalMarkers = [
    // Mostrar puestos nacionales con color según visitas
    ...(puestos?.map((p) => {
      const visitas = Number(p.visitas_count ?? 0);
      let color = "#10b981"; // verde si tiene visitas
      if (visitas === 0) color = "#ef4444"; // rojo si sin visitas
      else if (visitas < 3) color = "#f59e0b"; // naranja si pocas visitas
      
      return {
        lng: Number(p.lng ?? -84.09),
        lat: Number(p.lat ?? 9.92),
        title: `${String(p.name)}: ${visitas} visitas`,
        color,
        badge: visitas.toString()
      };
    }) || []),
    // Oficiales (GPS real y asignación a puesto)
    ...officerMarkers,
    // Armas con ubicación
    ...(weapons?.map(w => {
      const loc = (w.location as { lng?: number; lat?: number } | undefined) ?? {};
      return {
        lng: Number(loc.lng ?? -84.09),
        lat: Number(loc.lat ?? 9.92),
        title: `Arma: ${w.serial} (${w.status})`,
        color: w.status === 'Asignada' ? '#1E3A8A' : '#166534'
      };
    }) || [])
  ]

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-6 bg-primary" />
            <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
              DASHBOARD GLOBAL
            </h1>
          </div>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.3em] opacity-40">
            SISTEMA OPERATIVO DE SEGURIDAD TÁCTICA
          </p>
        </div>
        
        <div className="flex items-center gap-4 bg-white/5 p-3 rounded border border-white/5">
          <div className="flex flex-col items-end">
            <span className="text-[9px] font-black text-muted-foreground uppercase">OFICIAL AL MANDO</span>
            <span className="text-xs font-black text-primary uppercase">
              {user?.email?.split('@')[0] || "OPERATIVO_HQ"}
            </span>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div className="flex items-center gap-2">
             <div className="w-2 h-2 rounded-full bg-green-500" />
             <span className="text-[9px] font-black text-white uppercase tracking-widest">EN LÍNEA</span>
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        <Card className="bg-[#2d2a0e] border-primary/20 group hover:border-primary/40 transition-all">
          <CardContent className="p-4 md:p-8 flex flex-col items-center justify-center space-y-2">
            <Route className="w-6 h-6 md:w-8 md:h-8 text-primary mb-2" />
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-primary/80 text-center">RONDAS ACTIVAS</span>
            <span className="text-2xl md:text-4xl font-black text-primary italic">{rounds?.length || 0}</span>
          </CardContent>
        </Card>

        <Card className="bg-[#2d1717] border-red-500/20 group hover:border-red-500/40 transition-all">
          <CardContent className="p-4 md:p-8 flex flex-col items-center justify-center space-y-2">
            <ShieldAlert className="w-6 h-6 md:w-8 md:h-8 text-red-500 mb-2" />
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-red-400/80 text-center">INCIDENCIAS</span>
            <span className="text-2xl md:text-4xl font-black text-red-500 italic">{incidents?.length || 0}</span>
          </CardContent>
        </Card>

        <Card className="bg-[#0f1729] border-blue-500/20 group hover:border-blue-500/40 transition-all">
          <CardContent className="p-4 md:p-8 flex flex-col items-center justify-center space-y-2">
            <ClipboardCheck className="w-6 h-6 md:w-8 md:h-8 text-blue-500 mb-2" />
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-blue-400/80 text-center">SÚPER HOY</span>
            <span className="text-2xl md:text-4xl font-black text-blue-500 italic">{reports?.length || 0}</span>
          </CardContent>
        </Card>

        <Card className="bg-[#0f1f12] border-green-500/20 group hover:border-green-500/40 transition-all">
          <CardContent className="p-4 md:p-8 flex flex-col items-center justify-center space-y-2">
            <Zap className="w-6 h-6 md:w-8 md:h-8 text-green-500 mb-2" />
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-green-400/80 text-center">ARMAMENTO</span>
            <span className="text-2xl md:text-4xl font-black text-green-500 italic">{weapons?.length || 0}</span>
          </CardContent>
        </Card>

        <Card className="bg-[#1a1a1a] border-purple-500/20 group hover:border-purple-500/40 transition-all">
          <CardContent className="p-4 md:p-8 flex flex-col items-center justify-center space-y-2">
            <Globe className="w-6 h-6 md:w-8 md:h-8 text-purple-500 mb-2" />
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-purple-400/80 text-center">PUESTOS NACIONAL</span>
            <span className="text-2xl md:text-4xl font-black text-purple-500 italic">{puestos?.length || 0}</span>
          </CardContent>
        </Card>
      </div>

      {/* Tarjeta de Puestos con Visitas */}
      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white/90 flex items-center gap-2">
            <Globe className="w-4 h-4 text-purple-500" />
            PUESTOS A NIVEL NACIONAL
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {puestos?.map((p) => {
              const visitas = Number(p.visitas_count ?? 0);
              const statusColor = visitas === 0 ? 'bg-red-500/10 text-red-400' : visitas < 3 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-green-500/10 text-green-400';
              return (
                <div key={p.id} className="p-3 rounded-lg border border-white/5 bg-white/[0.02] hover:border-white/10 transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-black text-white uppercase truncate">{String(p.name)}</p>
                      <p className="text-[8px] text-white/50 uppercase mt-1">{String(p.region)}</p>
                    </div>
                    <div className={`px-2 py-1 rounded-full text-center flex-shrink-0 ${statusColor}`}>
                      <span className="text-[10px] font-black">{visitas}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white/90 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Incidentes por prioridad
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={incidentsByPriority} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
                <YAxis tick={{ fontSize: 10, fill: "rgba(255,255,255,0.6)" }} />
                <Tooltip contentStyle={{ backgroundColor: "#0c0c0c", border: "1px solid rgba(255,255,255,0.1)" }} labelStyle={{ color: "#fff" }} />
                <Bar dataKey="count" radius={4}>
                  {incidentsByPriority.map((_, i) => (
                    <Cell key={i} fill={["#ef4444", "#f97316", "#eab308", "#3b82f6"][i] ?? "#6b7280"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white/90 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              Alertas recientes
            </CardTitle>
            {criticalOpen > 0 && (
              <span className="text-[10px] font-black text-red-500 bg-red-500/10 px-2 py-0.5 rounded">
                {criticalOpen} críticos abiertos
              </span>
            )}
          </CardHeader>
          <CardContent>
            {recentAlerts.length === 0 ? (
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Sin alertas recientes</p>
            ) : (
              <ul className="space-y-2 max-h-[200px] overflow-y-auto">
                {recentAlerts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between text-[10px] py-1.5 border-b border-white/5 last:border-0">
                    <span className="font-mono text-white/70">
                      {(a.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—"}
                    </span>
                    <span className="text-red-400 font-black uppercase">SOS</span>
                    <span className="text-white/50 truncate max-w-[120px]">{String(a.userEmail ?? "")}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden relative">
        <div className="absolute top-4 md:top-6 left-4 md:left-8 z-20 flex items-center gap-2 md:gap-4">
          <div className="bg-primary p-1.5 md:p-2 rounded shadow-lg">
            <Globe className="w-4 h-4 md:w-5 md:h-5 text-black" />
          </div>
          <h2 className="text-xs md:text-lg font-black uppercase tracking-[0.2em] text-white italic">
            UBICACIÓN TÁCTICA
          </h2>
        </div>

        <CardContent className="p-0 relative h-[300px] md:h-[600px] w-full">
          <TacticalMap 
            markers={tacticalMarkers}
            center={[-84.0907, 9.9281]}
            zoom={10}
            className="w-full h-full"
          />
          
          <div className="absolute bottom-4 left-4 space-y-1.5 bg-black/80 p-2 md:p-4 rounded border border-white/5 backdrop-blur-md z-20">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#ef4444]" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">PUESTO SIN VISITAS</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#f59e0b]" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">PUESTO CON POCA VISITA</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#10b981]" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">PUESTO ACTIVO</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#06b6d4]" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">OFICIALES</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-[#1E3A8A]" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">ARMAS ASIGNADAS</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-[7px] md:text-[8px] font-black uppercase tracking-widest text-white/60">EN BODEGA</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="fixed bottom-6 right-6 flex flex-col items-end gap-4 z-[60]">
        <div className={cn(
          "flex flex-col items-end gap-4 transition-all duration-300 origin-bottom",
          isExpanded ? "scale-100 opacity-100 translate-y-0" : "scale-0 opacity-0 translate-y-10 pointer-events-none"
        )}>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">SUPERVISIÓN</span>
            <Link href="/supervision" className="bg-amber-600/90 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 hover:bg-amber-500/90 transition-colors">
              <ClipboardCheck className="w-5 h-5 text-white" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">INCIDENTES</span>
            <Link href="/incidents" className="bg-red-600/90 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 hover:bg-red-500/90 transition-colors">
              <AlertTriangle className="w-5 h-5 text-white" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">RONDAS</span>
            <Link href="/map" className="bg-emerald-600/90 w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 hover:bg-emerald-500/90 transition-colors">
              <Route className="w-5 h-5 text-white" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">CONTROL ARMAS</span>
            <Link href="/weapons" className="bg-[#1E3A8A] w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 hover:opacity-90 transition-opacity">
              <Zap className="w-5 h-5 text-white" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">SUPERVISIÓN AGRUPADA</span>
            <Link href="/supervision-agrupada" className="bg-primary w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10 hover:opacity-90 transition-colors">
              <Radio className="w-5 h-5 text-black" />
            </Link>
          </div>
        </div>

        <button onClick={() => setIsExpanded(!isExpanded)} className={cn("bg-primary w-12 h-12 md:w-14 md:h-14 rounded-full shadow-2xl flex items-center justify-center transition-all", isExpanded && "rotate-45 bg-white/10")}>
          {isExpanded ? <X className="w-6 h-6 text-white" /> : <Plus className="w-7 h-7 md:w-8 md:h-8 text-black" />}
        </button>
      </div>
    </div>
  )
}