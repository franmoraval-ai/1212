"use client"

import { useState, useEffect } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { 
  ShieldAlert, 
  ClipboardCheck, 
  Globe,
  Plus,
  Route,
  X,
  Radio,
  Zap
} from "lucide-react"
import { useFirestore, useCollection, useMemoFirebase, useUser } from "@/firebase"
import { collection } from "firebase/firestore"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { TacticalMap } from "@/components/ui/tactical-map"

export default function OverviewPage() {
  const db = useFirestore()
  const { user, isUserLoading } = useUser()
  const [isExpanded, setIsExpanded] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const roundsRef = useMemoFirebase(() => (db && user) ? collection(db, "rounds") : null, [db, user])
  const incidentsRef = useMemoFirebase(() => (db && user) ? collection(db, "incidents") : null, [db, user])
  const reportsRef = useMemoFirebase(() => (db && user) ? collection(db, "supervisions") : null, [db, user])
  const weaponsRef = useMemoFirebase(() => (db && user) ? collection(db, "weapons") : null, [db, user])

  const { data: rounds } = useCollection(roundsRef)
  const { data: incidents } = useCollection(incidentsRef)
  const { data: reports } = useCollection(reportsRef)
  const { data: weapons } = useCollection(weaponsRef)

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

  const tacticalMarkers = [
    { lng: -84.0907, lat: 9.9281, title: "HQ San José", color: "#C5A059" },
    ...(weapons?.map(w => ({
      lng: w.location?.lng || -84.09,
      lat: w.location?.lat || 9.92,
      title: `Arma: ${w.serial} (${w.status})`,
      color: w.status === 'Asignada' ? '#1E3A8A' : '#166534'
    })) || [])
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
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">CONTROL ARMAS</span>
            <Link href="/weapons" className="bg-[#1E3A8A] w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10">
              <Zap className="w-5 h-5 text-white" />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="bg-black/90 border border-white/5 px-3 py-1.5 rounded text-[9px] font-black text-white uppercase tracking-widest">MANDO Y CONTROL</span>
            <Link href="/mandos" className="bg-primary w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shadow-xl border border-white/10">
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