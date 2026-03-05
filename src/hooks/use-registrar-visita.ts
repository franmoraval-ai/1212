"use client"

import { useSupabase } from "@/supabase"
import { useToast } from "@/hooks/use-toast"

export function useRegistrarVisita() {
  const { supabase } = useSupabase()
  const { toast } = useToast()

  const registrarVisita = async (puestoId: string, officerName: string, motivo: string = "Visita de supervisión") => {
    try {
      const { data, error } = await supabase
        .from("visitas_puestos")
        .insert({
          puesto_id: puestoId,
          officer_name: officerName,
          motivo,
          entrada: new Date().toISOString()
        })
        .select()

      if (error) throw error

      toast({
        title: "VISITA REGISTRADA",
        description: "La visita ha sido señalada en el sistema.",
      })

      return { ok: true, data }
    } catch (err) {
      console.error("Error registrando visita:", err)
      toast({
        title: "ERROR",
        description: "No se pudo registrar la visita.",
        variant: "destructive"
      })
      return { ok: false, error: err }
    }
  }

  return { registrarVisita }
}
