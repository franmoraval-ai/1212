"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { BriefcaseBusiness } from "lucide-react"

export default function AccountAuditPage() {
  return (
    <div className="p-4 md:p-10 space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-xl md:text-2xl font-black uppercase tracking-wider text-white flex items-center gap-2">
            <BriefcaseBusiness className="w-5 h-5 text-primary" />
            Auditoria Gerencial en Pausa
          </CardTitle>
          <CardDescription className="text-white/60">
            Esta auditoria quedo temporalmente fuera de funcionamiento.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-white/70">
          Se reincorporara posteriormente con una version optimizada.
        </CardContent>
      </Card>
    </div>
  )
}
