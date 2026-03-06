"use client"
import { useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { 
  ShieldAlert, 
  ClipboardCheck, 
  Globe,
  Route,
  Zap,
  AlertTriangle,
  Siren,
  Clock3,
  BarChart3,
  Shield
} from "lucide-react"
import { useCollection, useUser } from "@/supabase"
import { TacticalMap } from "@/components/ui/tactical-map"
import { toDateSafe } from "@/lib/field-intel"

function parseFrequencyMinutes(raw: string) {
  const value = String(raw || "").toLowerCase()
  const match = value.match(/(\d+(?:[\.,]\d+)?)/)
  const amount = match ? Number(match[1].replace(",", ".")) : 30
  if (value.includes("hora")) return Math.max(1, Math.round(amount * 60))
  return Math.max(1, Math.round(amount))
}

export default function OverviewPage() {
  const { user, isUserLoading } = useUser()
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [])

  const { data: rounds } = useCollection(user ? "rounds" : null)
  const { data: incidents } = useCollection(user ? "incidents" : null)
  const { data: reports } = useCollection(user ? "supervisions" : null)
  const { data: weapons } = useCollection(user ? "weapons" : null)
  const { data: puestos } = useCollection(user ? "puestos" : null)
  const { data: personnel } = useCollection(user ? "users" : null)

  const criticalOpen = incidents?.filter((i) => (i.priorityLevel === "Critical") && (i.status !== "Cerrado")).length ?? 0

  const computed = useMemo(() => {
    const now = nowMs
    const reportsList = reports ?? []
    const roundsList = rounds ?? []
    const incidentsList = incidents ?? []
    const puestosList = puestos ?? []

    const reportsByPost = new Map<string, Array<{ date: Date; status: string; geoRiskLevel?: string }>>()
    reportsList.forEach((r) => {
      const post = String(r.reviewPost ?? "").trim().toLowerCase()
      if (!post) return
      const d = toDateSafe(r.createdAt)
      if (!d) return
      const list = reportsByPost.get(post) ?? []
      list.push({
        date: d,
        status: String(r.status ?? ""),
        geoRiskLevel: String(r.geoRiskLevel ?? (r.geoRisk as { riskLevel?: string } | undefined)?.riskLevel ?? ""),
      })
      reportsByPost.set(post, list)
    })

    let overdueCheckpoints = 0
    let delayedRounds = 0
    const overdueDetails: string[] = []

    roundsList.forEach((round) => {
      const post = String(round.post ?? "").trim().toLowerCase()
      const freqMins = parseFrequencyMinutes(String(round.frequency ?? "Cada 30 minutos"))
      const latest = (reportsByPost.get(post) ?? []).sort((a, b) => b.date.getTime() - a.date.getTime())[0]
      if (!latest) {
        overdueCheckpoints += 1
        delayedRounds += 1
        overdueDetails.push(`${String(round.name ?? "Ronda")}: sin supervisiones`) 
        return
      }

      const elapsedMins = (now - latest.date.getTime()) / 60000
      if (elapsedMins > freqMins) {
        overdueCheckpoints += 1
      }
      if (elapsedMins > freqMins * 1.5) {
        delayedRounds += 1
        overdueDetails.push(`${String(round.name ?? "Ronda")}: ${Math.round(elapsedMins)} min sin reporte`) 
      }
    })

    const dayAgo = now - 24 * 60 * 60000
    const zonesWithoutReport = puestosList.filter((p) => {
      const post = String(p.name ?? "").trim().toLowerCase()
      const latest = (reportsByPost.get(post) ?? []).sort((a, b) => b.date.getTime() - a.date.getTime())[0]
      return !latest || latest.date.getTime() < dayAgo
    }).length

    const complianceByPost = Array.from(reportsByPost.entries()).map(([post, list]) => {
      const total = list.length
      const compliant = list.filter((x) => String(x.status).toUpperCase().includes("CUMPLIM")).length
      const pct = total ? Math.round((compliant / total) * 100) : 0
      return { post, pct, total }
    }).sort((a, b) => b.pct - a.pct)

    const topCompliance = complianceByPost.slice(0, 5)

    let totalDiff = 0
    let totalPairs = 0
    Array.from(reportsByPost.values()).forEach((list) => {
      const ordered = [...list].sort((a, b) => a.date.getTime() - b.date.getTime())
      for (let i = 1; i < ordered.length; i += 1) {
        totalDiff += ordered[i].date.getTime() - ordered[i - 1].date.getTime()
        totalPairs += 1
      }
    })
    const avgCycleMinutes = totalPairs ? Math.round(totalDiff / totalPairs / 60000) : 0

    const slots = {
      madrugada: 0,
      manana: 0,
      tarde: 0,
      noche: 0,
    }

    incidentsList.forEach((incident) => {
      const d = toDateSafe(incident.time ?? incident.timestamp)
      if (!d) return
      const h = d.getHours()
      if (h < 6) slots.madrugada += 1
      else if (h < 12) slots.manana += 1
      else if (h < 18) slots.tarde += 1
      else slots.noche += 1
    })

    const highRiskReports = reportsList.filter((r) => {
      const risk = String(r.geoRiskLevel ?? (r.geoRisk as { riskLevel?: string } | undefined)?.riskLevel ?? "").toLowerCase()
      return risk === "high"
    }).length

    return {
      overdueCheckpoints,
      delayedRounds,
      zonesWithoutReport,
      topCompliance,
      avgCycleMinutes,
      slots,
      highRiskReports,
      overdueDetails: overdueDetails.slice(0, 3),
    }
  }, [reports, rounds, incidents, puestos, nowMs])

  if (isUserLoading) {
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
          {criticalOpen > 0 && (
            <div className="mt-3 inline-flex items-center gap-2 rounded border border-red-500/20 bg-red-500/10 px-3 py-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span className="text-[10px] font-black uppercase tracking-wider text-red-300">
                {criticalOpen} incidencias críticas abiertas
              </span>
            </div>
          )}
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
            <span className="text-[7px] md:text-[9px] font-black uppercase tracking-widest text-purple-400/80 text-center">PUESTOS NACIONALES</span>
            <span className="text-2xl md:text-4xl font-black text-purple-500 italic">{puestos?.length || 0}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        <Card className="bg-[#1b0f10] border-red-500/25">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-red-300 flex items-center gap-2">
              <Siren className="w-4 h-4" /> Alertas inteligentes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[10px] uppercase">
            <div className="flex items-center justify-between"><span className="text-white/70">Checkpoint vencido</span><span className="font-black text-red-300">{computed.overdueCheckpoints}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/70">Ronda atrasada</span><span className="font-black text-red-300">{computed.delayedRounds}</span></div>
            <div className="flex items-center justify-between"><span className="text-white/70">Zona sin reporte (24h)</span><span className="font-black text-red-300">{computed.zonesWithoutReport}</span></div>
            {computed.overdueDetails.map((detail) => (
              <p key={detail} className="text-[9px] text-red-200/80">- {detail}</p>
            ))}
          </CardContent>
        </Card>

        <Card className="bg-[#0f1729] border-blue-500/25">
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-black uppercase tracking-widest text-blue-300 flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> KPI ejecutivo tiempo real
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-[10px] uppercase">
            <div className="flex items-center justify-between"><span className="text-white/70">Tiempo promedio entre reportes</span><span className="font-black text-blue-300">{computed.avgCycleMinutes} min</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-white/10 p-2"><p className="text-white/60">00-06</p><p className="font-black text-white">{computed.slots.madrugada}</p></div>
              <div className="rounded border border-white/10 p-2"><p className="text-white/60">06-12</p><p className="font-black text-white">{computed.slots.manana}</p></div>
              <div className="rounded border border-white/10 p-2"><p className="text-white/60">12-18</p><p className="font-black text-white">{computed.slots.tarde}</p></div>
              <div className="rounded border border-white/10 p-2"><p className="text-white/60">18-24</p><p className="font-black text-white">{computed.slots.noche}</p></div>
            </div>
            <p className="text-[9px] text-blue-200/80">Cumplimiento por puesto (top 5)</p>
            {computed.topCompliance.map((item) => (
              <div key={item.post} className="flex items-center justify-between text-[9px]">
                <span className="text-white/70 truncate max-w-[70%]">{item.post.toUpperCase()}</span>
                <span className="font-black text-blue-300">{item.pct}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#1a1410] border-amber-500/25">
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-300" />
            <span className="text-[10px] font-black uppercase tracking-wider text-amber-200">Trazabilidad antifraude</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock3 className="w-4 h-4 text-amber-300" />
            <span className="text-[10px] font-black uppercase text-amber-100">Reportes con riesgo alto GPS: {computed.highRiskReports}</span>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden relative">
        <CardHeader className="absolute top-2 left-2 z-20 bg-black/45 border border-white/10 rounded-md backdrop-blur-md p-2 md:p-3">
          <CardTitle className="text-[10px] md:text-xs font-black uppercase tracking-[0.18em] text-white/90 flex items-center gap-2">
            <Globe className="w-4 h-4 text-primary" />
            Ubicación táctica
          </CardTitle>
        </CardHeader>

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
    </div>
  )
}