"use client"

import { useState } from "react"
import { useSupabase, useUser } from "@/supabase"
import { nowIso } from "@/lib/supabase-db"
import { AlertTriangle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

export function SosButton() {
  const { supabase, user } = useSupabase()
  const { toast } = useToast()
  const [sending, setSending] = useState(false)

  const handleSos = async () => {
    if (!user) {
      toast({ title: "Error", description: "Debe iniciar sesión para enviar alerta.", variant: "destructive" })
      return
    }
    setSending(true)
    try {
      let lat: number | null = null
      let lng: number | null = null
      if (typeof navigator !== "undefined" && navigator.geolocation) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 })
          })
          lat = pos.coords.latitude
          lng = pos.coords.longitude
        } catch {
          // Sin ubicación
        }
      }
      const { error } = await supabase.from("alerts").insert({
        type: "sos",
        user_id: user.uid,
        user_email: user.email ?? "",
        created_at: nowIso(),
        ...(lat != null && lng != null && { location: { lat, lng } }),
      })
      if (error) throw error
      toast({ title: "Alerta SOS enviada", description: "El centro de mando ha sido notificado.", variant: "default" })
    } catch (e) {
      toast({ title: "Error", description: "No se pudo enviar la alerta.", variant: "destructive" })
    } finally {
      setSending(false)
    }
  }

  return (
    <button
      type="button"
      onClick={handleSos}
      disabled={sending}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-colors disabled:opacity-50"
      title="Enviar alerta SOS"
    >
      <AlertTriangle className="w-4 h-4" />
      <span className="text-[10px] font-black uppercase tracking-wider hidden sm:inline">SOS</span>
    </button>
  )
}
