"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  Zap, 
  Search, 
  Plus, 
  MapPin, 
  Loader2, 
  Trash2,
  Filter,
  ShieldCheck
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useFirestore, useCollection, useMemoFirebase, useUser } from "@/firebase"
import { collection, query, orderBy, addDoc, deleteDoc, doc, serverTimestamp } from "firebase/firestore"
import { errorEmitter } from "@/firebase/error-emitter"
import { FirestorePermissionError } from "@/firebase/errors"
import { useToast } from "@/hooks/use-toast"
import { TacticalMap } from "@/components/ui/tactical-map"

export default function WeaponsPage() {
  const db = useFirestore()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  
  const [formData, setFormData] = useState({
    model: "",
    serial: "",
    type: "Pistola",
    status: "Bodega",
    assignedTo: "",
    location: { lat: 9.9281, lng: -84.0907 }
  })

  const weaponsRef = useMemoFirebase(() => {
    if (!db || !user) return null
    return query(collection(db, "weapons"), orderBy("serial", "asc"))
  }, [db, user])

  const { data: weapons, isLoading: loading } = useCollection(weaponsRef)

  const handleAddWeapon = () => {
    if (!db || !formData.model || !formData.serial) {
      toast({ title: "Error", description: "Modelo y serie son obligatorios.", variant: "destructive" })
      return
    }
    
    const newWeapon = {
      ...formData,
      lastCheck: serverTimestamp(),
    }

    addDoc(collection(db, "weapons"), newWeapon)
      .then(() => {
        toast({ title: "Arma Registrada", description: `Serie ${formData.serial} ingresada al inventario.` })
        setIsOpen(false)
        setFormData({ model: "", serial: "", type: "Pistola", status: "Bodega", assignedTo: "", location: { lat: 9.9281, lng: -84.0907 } })
      })
      .catch((e) => {
        const error = new FirestorePermissionError({ path: "weapons", operation: "create", requestResourceData: newWeapon })
        errorEmitter.emit("permission-error", error)
      })
  }

  const handleDelete = (id: string) => {
    if (!db) return
    deleteDoc(doc(db, "weapons", id))
      .catch(() => {
        const error = new FirestorePermissionError({ path: `weapons/${id}`, operation: "delete" })
        errorEmitter.emit("permission-error", error)
      })
  }

  const filteredWeapons = weapons?.filter(w => 
    w.serial.toLowerCase().includes(searchTerm.toLowerCase()) || 
    w.model.toLowerCase().includes(searchTerm.toLowerCase())
  )

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            CONTROL DE ARMAMENTO
          </h1>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            INVENTARIO Y RASTREO TÁCTICO DE EQUIPO
          </p>
        </div>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-12 px-6 gap-2 rounded shadow-lg">
              <Plus className="w-5 h-5 stroke-[3px]" />
              INGRESAR ARMA
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-black uppercase italic text-xl">REGISTRO DE EQUIPO</DialogTitle>
              <DialogDescription className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
                ALTA DE ARMAMENTO INSTITUCIONAL
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Modelo</Label>
                  <Input value={formData.model} onChange={e => setFormData({...formData, model: e.target.value})} className="bg-white/5 border-white/10 h-11" placeholder="Ej: Glock 17 Gen 5" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Número de Serie</Label>
                  <Input value={formData.serial} onChange={e => setFormData({...formData, serial: e.target.value})} className="bg-white/5 border-white/10 h-11" placeholder="Ej: ABC12345" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Tipo</Label>
                    <Select onValueChange={v => setFormData({...formData, type: v})} defaultValue="Pistola">
                      <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Pistola">Pistola</SelectItem>
                        <SelectItem value="Revolver">Revólver</SelectItem>
                        <SelectItem value="Escopeta">Escopeta</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Estado</Label>
                    <Select onValueChange={v => setFormData({...formData, status: v})} defaultValue="Bodega">
                      <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bodega">Bodega</SelectItem>
                        <SelectItem value="Asignada">Asignada</SelectItem>
                        <SelectItem value="Mantenimiento">Mantenimiento</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {formData.status === 'Asignada' && (
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Asignada a (Nombre)</Label>
                    <Input value={formData.assignedTo} onChange={e => setFormData({...formData, assignedTo: e.target.value})} className="bg-white/5 border-white/10 h-11" />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Ubicación Actual / Asignación</Label>
                <div className="h-[250px] w-full relative">
                  <TacticalMap 
                    center={[formData.location.lng, formData.location.lat]}
                    zoom={12}
                    onLocationSelect={(lng, lat) => setFormData({...formData, location: { lat, lng }})}
                    markers={[{ ...formData.location, color: '#C5A059' }]}
                    className="w-full h-full"
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddWeapon} className="w-full bg-primary text-black font-black h-12 uppercase">CERTIFICAR INGRESO</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="md:col-span-1 bg-[#111111] border-white/5 p-6 space-y-6 h-fit">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase text-primary">Búsqueda Técnica</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input 
                className="pl-10 bg-black/40 border-white/10 text-xs font-bold" 
                placeholder="SERIE O MODELO..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-4">
            <div className="p-4 bg-black/40 rounded border border-white/5">
              <span className="text-[9px] font-black text-muted-foreground uppercase">TOTAL ARMAS</span>
              <p className="text-3xl font-black text-white">{weapons?.length || 0}</p>
            </div>
            <div className="p-4 bg-[#1E3A8A]/10 rounded border border-[#1E3A8A]/20">
              <span className="text-[9px] font-black text-[#1E3A8A] uppercase">ASIGNADAS</span>
              <p className="text-3xl font-black text-white">{weapons?.filter(w => w.status === 'Asignada').length || 0}</p>
            </div>
          </div>
        </Card>

        <Card className="md:col-span-3 bg-[#111111] border-white/5 overflow-hidden">
          <Table>
            <TableHeader className="bg-white/5">
              <TableRow className="border-white/5">
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground px-6">ARMA / SERIE</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">TIPO</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">RESPONSABLE</TableHead>
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground">ESTADO</TableHead>
                <TableHead className="text-right px-6"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredWeapons && filteredWeapons.length > 0 ? (
                filteredWeapons.map((weapon) => (
                  <TableRow key={weapon.id} className="border-white/5 hover:bg-white/[0.02]">
                    <TableCell className="px-6">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black text-white uppercase italic">{weapon.model}</span>
                        <span className="text-[9px] font-mono text-primary font-bold">{weapon.serial}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">{weapon.type}</TableCell>
                    <TableCell className="text-[10px] font-black text-white uppercase italic">{weapon.assignedTo || "DISPONIBLE"}</TableCell>
                    <TableCell>
                      <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-sm ${
                        weapon.status === 'Asignada' ? 'bg-[#1E3A8A] text-white' :
                        weapon.status === 'Mantenimiento' ? 'bg-orange-600 text-white' :
                        'bg-green-600 text-white'
                      }`}>
                        {weapon.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white/20 hover:text-destructive" onClick={() => handleDelete(weapon.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={5} className="h-64 text-center text-muted-foreground/30 font-black uppercase tracking-widest text-[10px]">
                    SIN REGISTROS EN INVENTARIO
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  )
}