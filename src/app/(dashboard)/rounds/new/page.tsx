
"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Navigation, 
  Plus, 
  Trash2, 
  QrCode, 
  MapPin, 
  Save,
  Loader2,
  ChevronRight
} from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useFirestore } from "@/firebase"
import { collection, addDoc } from "firebase/firestore"
import { useToast } from "@/hooks/use-toast"

export default function NewRoundPage() {
  const [loading, setLoading] = useState(false)
  const [checkpoints, setCheckpoints] = useState([{ name: "", qr: "" }])
  const [formData, setFormData] = useState({
    name: "",
    operationId: "",
    puestoBase: "",
    instructions: ""
  })
  const db = useFirestore()
  const { toast } = useToast()

  const addCheckpoint = () => {
    setCheckpoints([...checkpoints, { name: "", qr: "" }])
  }

  const removeCheckpoint = (index: number) => {
    setCheckpoints(checkpoints.filter((_, i) => i !== index))
  }

  const handleSave = async () => {
    if (!db) return
    setLoading(true)
    
    const roundData = {
      ...formData,
      checkpoints,
      status: "Activa",
      createdAt: new Date().toISOString()
    }

    try {
      await addDoc(collection(db, "rounds"), roundData)
      toast({ title: "RONDA CREADA", description: "El patrullaje maestro ha sido configurado exitosamente." })
      setCheckpoints([{ name: "", qr: "" }])
      setFormData({ name: "", operationId: "", puestoBase: "", instructions: "" })
    } catch (e) {
      toast({ title: "ERROR", description: "No se pudo guardar la configuración táctica.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-10 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 border-b border-[#F59E0B]/20 pb-6">
        <div className="bg-[#F59E0B] p-3 rounded shadow-[0_0_20px_rgba(245,158,11,0.3)]">
          <Navigation className="w-8 h-8 text-black" />
        </div>
        <div className="space-y-1">
          <h1 className="text-4xl font-black text-white uppercase italic tracking-tighter">NUEVA RONDA MAESTRA</h1>
          <p className="text-[10px] font-black text-[#F59E0B]/80 uppercase tracking-widest">PROGRAMACIÓN DE PATRULLAJE TÁCTICO</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <Card className="bg-[#111111] border-white/5 tactical-card">
            <CardHeader>
              <CardTitle className="text-xs font-black text-[#F59E0B] uppercase tracking-widest italic">CONFIGURACIÓN BASE</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase opacity-60">OPERACIÓN ASOCIADA</Label>
                <Select value={formData.operationId} onValueChange={(v) => setFormData({...formData, operationId: v})}>
                  <SelectTrigger className="bg-black/40 border-white/10 h-11 text-xs font-bold uppercase">
                    <SelectValue placeholder="SELECCIONAR" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#111111] border-white/10 text-white font-bold uppercase text-xs">
                    <SelectItem value="OP_1">VÍA DON BOSCO</SelectItem>
                    <SelectItem value="OP_2">BCR CENTRAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase opacity-60">NOMBRE DEL PATRULLAJE</Label>
                <Input 
                  placeholder="EJ: RONDA PERIMETRAL NOCTURNA" 
                  className="bg-black/40 border-white/10 h-11 text-xs font-bold uppercase"
                  value={formData.name}
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] font-black uppercase opacity-60">PUESTO O BASE</Label>
                <Input 
                  placeholder="EJ: BASE CENTRAL ZONA 1" 
                  className="bg-black/40 border-white/10 h-11 text-xs font-bold uppercase"
                  value={formData.puestoBase}
                  onChange={(e) => setFormData({...formData, puestoBase: e.target.value})}
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black text-white uppercase tracking-widest italic">PUNTOS DE CONTROL (CHECKPOINTS)</h2>
            <Button onClick={addCheckpoint} variant="outline" className="h-8 text-[10px] font-black uppercase border-[#F59E0B]/40 text-[#F59E0B]">
              <Plus className="w-3 h-3 mr-1" /> AÑADIR PUNTO
            </Button>
          </div>

          <div className="space-y-4">
            {checkpoints.map((cp, idx) => (
              <Card key={idx} className="bg-[#111111] border-white/5 tactical-card relative overflow-hidden">
                <div className="absolute left-0 top-0 w-1 h-full bg-[#F59E0B]" />
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end">
                    <div className="md:col-span-1 flex items-center justify-center">
                      <span className="text-2xl font-black text-white/10 italic">#{idx + 1}</span>
                    </div>
                    <div className="md:col-span-5 space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-50">NOMBRE DEL PUNTO</Label>
                      <Input 
                        placeholder="EJ: PUERTA 4 SUR" 
                        className="bg-black/40 border-white/10 h-11 text-xs font-bold uppercase"
                        value={cp.name}
                        onChange={(e) => {
                          const newCp = [...checkpoints]
                          newCp[idx].name = e.target.value
                          setCheckpoints(newCp)
                        }}
                      />
                    </div>
                    <div className="md:col-span-5 space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-50">CÓDIGO QR / GPS</Label>
                      <div className="flex gap-2">
                        <Input 
                          placeholder="SCAN QR..." 
                          className="bg-black/40 border-white/10 h-11 text-xs font-bold uppercase flex-1"
                          value={cp.qr}
                          onChange={(e) => {
                            const newCp = [...checkpoints]
                            newCp[idx].qr = e.target.value
                            setCheckpoints(newCp)
                          }}
                        />
                        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 border-white/10 bg-white/5">
                          <QrCode className="w-4 h-4 text-[#F59E0B]" />
                        </Button>
                        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 border-white/10 bg-white/5">
                          <MapPin className="w-4 h-4 text-green-500" />
                        </Button>
                      </div>
                    </div>
                    <div className="md:col-span-1 flex justify-end">
                      <Button onClick={() => removeCheckpoint(idx)} variant="ghost" size="icon" className="text-red-500/50 hover:text-red-500 hover:bg-red-500/10">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="pt-6">
            <Button 
              onClick={handleSave}
              disabled={loading}
              className="w-full h-14 bg-[#F59E0B] hover:bg-[#D97706] text-black font-black uppercase tracking-[0.2em] italic shadow-[0_0_30px_rgba(245,158,11,0.2)]"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : <Save className="w-5 h-5 mr-2" />}
              CREAR RONDA MAESTRA
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
