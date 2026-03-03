"use client"

import { useState, useEffect } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { 
  BarChart3, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2,
  Clock,
  ShieldCheck
} from "lucide-react"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartConfig,
} from "@/components/ui/chart"
import { Bar, BarChart, CartesianGrid, XAxis, ResponsiveContainer } from "recharts"

const stats = [
  { label: "Cumplimiento", value: 94, icon: ShieldCheck, color: "text-green-500" },
  { label: "Incidentes", value: 2, icon: AlertCircle, color: "text-red-500" },
  { label: "Rondas", value: 88, icon: CheckCircle2, color: "text-blue-500" },
  { label: "Respuesta", value: "4m", icon: Clock, color: "text-primary" },
]

const chartData = [
  { zone: "N", performance: 85 },
  { zone: "S", performance: 92 },
  { zone: "E", performance: 78 },
  { zone: "O", performance: 95 },
  { zone: "C", performance: 88 },
]

const chartConfig = {
  performance: {
    label: "Rendimiento",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig

export default function RevisionAgrupadaPage() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <div className="scanline" />
      
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic leading-none">
          REVISIÓN AGRUPADA
        </h1>
        <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
          Métricas consolidadas de operaciones.
        </p>
      </div>

      {/* Grid de Estadísticas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md overflow-hidden group hover:border-primary/20 transition-all border-l-2 md:border-l-4 border-l-transparent hover:border-l-primary">
            <CardContent className="p-4 md:p-6">
              <div className="flex justify-between items-start mb-2 md:mb-4">
                <div className={`p-1.5 md:p-2 rounded-lg bg-white/5 ${stat.color}`}>
                  <stat.icon className="w-4 h-4 md:w-5 md:h-5" />
                </div>
              </div>
              <div className="space-y-0.5 md:space-y-1">
                <h3 className="text-xl md:text-3xl font-black text-white tracking-tighter italic glow-text">
                  {typeof stat.value === 'number' ? `${stat.value}%` : stat.value}
                </h3>
                <p className="text-[8px] md:text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                  {stat.label}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Rendimiento por Operación */}
        <Card className="lg:col-span-2 bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md">
          <CardHeader className="px-4 md:px-6">
            <CardTitle className="text-lg md:text-xl font-black uppercase italic tracking-tighter text-white">Análisis</CardTitle>
            <CardDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Eficiencia por zona.</CardDescription>
          </CardHeader>
          <CardContent className="pt-2 px-2 md:px-6 md:pt-6">
            <ChartContainer config={chartConfig} className="min-h-[200px] md:min-h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
                  <XAxis 
                    dataKey="zone" 
                    tickLine={false} 
                    axisLine={false} 
                    tick={{fill: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 900}} 
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar 
                    dataKey="performance" 
                    fill="var(--color-performance)" 
                    radius={[4, 4, 0, 0]} 
                    barSize={30}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ChartContainer>
          </CardContent>
        </Card>

        {/* Alertas Recientes */}
        <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md">
          <CardHeader className="px-4 md:px-6">
            <CardTitle className="text-lg md:text-xl font-black uppercase italic tracking-tighter text-white">Alertas</CardTitle>
            <CardDescription className="text-[10px] uppercase font-bold text-muted-foreground tracking-widest">Amenazas 24/7.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 md:space-y-6 pt-2 md:pt-4 px-4 md:px-6">
            {[
              { title: "Falla Conectividad", detail: "Puesto Sabana. 15m", color: "red" },
              { title: "Incremento Actividad", detail: "Sector Correos. 1h", color: "yellow" },
              { title: "Ronda Incompleta", detail: "Sector Sur. 2h", color: "red" },
            ].map((alert, i) => (
              <div key={i} className={`flex gap-3 p-3 rounded-lg bg-${alert.color}-500/10 border border-${alert.color}-500/20 relative overflow-hidden`}>
                <div className={`absolute top-0 left-0 w-1 h-full bg-${alert.color}-500`} />
                <AlertCircle className={`w-4 h-4 text-${alert.color}-500 shrink-0`} />
                <div className="space-y-0.5">
                  <p className="text-[10px] md:text-xs font-black text-white uppercase tracking-tight">{alert.title}</p>
                  <p className="text-[8px] md:text-[10px] text-muted-foreground uppercase leading-tight">{alert.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
