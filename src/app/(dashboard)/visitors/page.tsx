"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { UserX2 } from "lucide-react"

export default function VisitorsPage() {
  return (
    <div className="p-4 md:p-10 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-wider text-white flex items-center gap-2">
            <UserX2 className="w-5 h-5 text-primary" />
            Registro de Visitantes en Pausa
          </CardTitle>
          <CardDescription className="text-white/60">
            El registro de visitantes quedo fuera de operacion temporalmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-white/70">
          Este modulo se incorporara de nuevo cuando se reactive el plan completo.
        </CardContent>
      </Card>
    </div>
  )
}
