
"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { 
  ShieldAlert, 
  MapPin, 
  Camera, 
  Loader2
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useFirestore, useUser } from "@/firebase"
import { collection, addDoc, serverTimestamp } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"
import { errorEmitter } from "@/firebase/error-emitter"
import { FirestorePermissionError } from "@/firebase/errors"
import { TacticalMap } from "@/components/ui/tactical-map"

export default function ReportIncidentPage() {
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    operation: "",
    severity: "Media",
    description: "",
    location: { lng: -84.0907, lat: 9.9281 }
  })
  const db = useFirestore()
  const { user } = useUser()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!db || !user) return

    setLoading(true)
    const incidentData = {
      ...formData,
      reporterUid: user.uid,
      timestamp: serverTimestamp(),
      status: "PENDIENTE",
      reportedBy: "SISTEMA WEB"
    }

    addDoc(collection(db, "incidents"), incidentData)
      .then(() => {
        toast({ title: "REPORTE ENVIADO", description: "La incidencia ha sido registrada en el sistema central." })
        setFormData({ operation: "", severity: "Media", description: "", location: { lng: -84.0907, lat: 9.9281 } })
      })
      .catch((e) => {
        const error = new FirestorePermissionError({ path: "incidents", operation: "create", requestResourceData: incidentData })
        errorEmitter.emit("permission-error", error)
      })
      .finally(() => setLoading(false))
  }

  const handleLocationSelect = (lng: number, lat: number) => {
    setFormData({ ...formData, location: { lng, lat } })
    toast({ title: "Ubicación Fijada", description: `Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}` })
  }

  return (
    <div className="p-4 md:p-10 max-w-4xl mx-auto space-y-10 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 border-b border-red-500/20 pb-6">
        <div className="bg-red-600 p-3 rounded shadow-[0_0_20px_rgba(220,38,38,0.4)]">
          <ShieldAlert className="w-8 h-8 text-white" />
        </div>
        <div className="space-y-1">
          <h1 className="text-4xl font-black text-white uppercase italic tracking-tighter">REPORTAR INCIDENTE</h1>
          <p className="text-[10px] font-black text-red-500/80 uppercase tracking-widest">PROTOCOLO DE EMERGENCIA - HO SEGURIDAD</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-8">
          <Card className="bg-[#111111] border-white/5 tactical-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-black text-[#F59E0B] uppercase italic tracking-widest">Detalles del Reporte</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Operación Asociada</Label>
                <Select value={formData.operation} onValueChange={(v) => setFormData({...formData, operation: v})}>
                  <SelectTrigger className="bg-black/40 border-white/10 h-12 font-bold uppercase text-xs text-white">
                    <SelectValue placeholder="SELECCIONAR OPERACIÓN" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111111] border-white/10 text-white font-bold uppercase text-xs">
                    <SelectItem value="VIA_DON_BOSCO">VÍA DON BOSCO</SelectItem>
                    <SelectItem value="BCR_CARTAGO">BCR CARTAGO</SelectItem>
                    <SelectItem value="SABANA_OFFICE">SABANA OFFICE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Severidad</Label>
                <Select value={formData.severity} onValueChange={(v) => setFormData({...formData, severity: v})}>
                  <SelectTrigger className="bg-black/40 border-white/10 h-12 font-bold uppercase text-xs text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111111] border-white/10 text-white font-bold uppercase text-xs">
                    <SelectItem value="Baja">Baja (Mínimo impacto)</SelectItem>
                    <SelectItem value="Media">Media (Acceso no autorizado/daños)</SelectItem>
                    <SelectItem value="Alta">Alta (Peligro inminente/asalto)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase tracking-widest opacity-60">Descripción de la Novedad</Label>
                <Textarea 
                  placeholder="DETALLE LOS HECHOS CON PRECISIÓN..." 
                  className="bg-black/40 border-white/10 min-h-[120px] font-bold text-xs uppercase text-white"
                  value={formData.description}
                  onChange={(e) => setFormData({...formData, description: e.target.value})}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="bg-[#111111] border-white/5 tactical-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-black text-[#F59E0B] uppercase italic tracking-widest">Ubicación del Evento</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="h-[250px] w-full relative">
                <TacticalMap 
                  center={[formData.location.lng, formData.location.lat]}
                  zoom={14}
                  markers={[{ ...formData.location, color: '#ef4444', title: 'Incidente' }]}
                  onLocationSelect={handleLocationSelect}
                  className="w-full h-full"
                />
                <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-[8px] font-bold text-white z-10 border border-white/10">
                  HAGA CLIC EN EL MAPA PARA AJUSTAR UBICACIÓN
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#111111] border-white/5 tactical-card">
            <CardHeader className="pb-4">
              <CardTitle className="text-sm font-black text-[#F59E0B] uppercase italic tracking-widest">Evidencia Fotográfica</CardTitle>
            </CardHeader>
            <CardContent>
              <Button type="button" variant="outline" className="w-full h-24 border-dashed border-white/10 bg-black/40 hover:bg-black/60 group">
                <div className="flex flex-col items-center space-y-2">
                  <div className="p-2 rounded-full bg-white/5 group-hover:bg-[#F59E0B]/10 group-hover:text-[#F59E0B] transition-all">
                    <Camera className="w-5 h-5" />
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-[0.2em] text-white">AÑADIR EVIDENCIA</span>
                </div>
              </Button>
            </CardContent>
          </Card>
        </div>

        <div className="md:col-span-2 flex items-center gap-4 pt-6 border-t border-white/5">
          <Button variant="ghost" type="button" className="flex-1 h-14 text-muted-foreground hover:text-white font-black uppercase tracking-widest">CANCELAR</Button>
          <Button type="submit" disabled={loading} className="flex-[2] h-14 bg-[#F59E0B] hover:bg-[#D97706] text-black font-black uppercase tracking-[0.2em] italic shadow-[0_0_30px_rgba(245,158,11,0.2)]">
            {loading ? (
              <><Loader2 className="w-5 h-5 animate-spin mr-2" /> PROCESANDO REPORTE...</>
            ) : (
              "ENVIAR REPORTE AL CENTRO DE MANDO"
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}
