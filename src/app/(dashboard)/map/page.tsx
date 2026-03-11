"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { RouteOff } from "lucide-react"

export default function MaestroDeRondasPage() {
  return (
    <div className="p-4 md:p-10 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-wider text-white flex items-center gap-2">
            <RouteOff className="w-5 h-5 text-primary" />
            Maestro de Rondas en Pausa
          </CardTitle>
          <CardDescription className="text-white/60">
            Este modulo fue retirado temporalmente para bajar consumo de recursos.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-white/70">
          Rehabilitaremos esta pantalla mas adelante cuando finalice la contingencia.
        </CardContent>
      </Card>
    </div>
  )
}
