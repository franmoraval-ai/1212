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
  ShieldCheck,
  FileSpreadsheet,
  FileDown
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
import { useSupabase, useCollection, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { useToast } from "@/hooks/use-toast"
import { TacticalMap } from "@/components/ui/tactical-map"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"

export default function WeaponsPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("TODOS")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const [formData, setFormData] = useState({
    model: "",
    serial: "",
    type: "Pistola",
    status: "Bodega",
    assignedTo: "",
    location: { lat: 9.9281, lng: -84.0907 }
  })

  const { data: weapons, isLoading: loading } = useCollection(user ? "weapons" : null, { orderBy: "serial", orderDesc: false })

  const handleAddWeapon = async () => {
    if (!formData.model || !formData.serial) {
      toast({ title: "Error", description: "Modelo y serie son obligatorios.", variant: "destructive" })
      return
    }
    
    const row = toSnakeCaseKeys({ ...formData, lastCheck: nowIso() }) as Record<string, unknown>
    const { error } = await supabase.from("weapons").insert(row)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Arma Registrada", description: `Serie ${formData.serial} ingresada al inventario.` })
    setIsOpen(false)
    setFormData({ model: "", serial: "", type: "Pistola", status: "Bodega", assignedTo: "", location: { lat: 9.9281, lng: -84.0907 } })
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const { error } = await supabase.from("weapons").delete().eq("id", id)
      if (error) throw error
      toast({ title: "Eliminado", description: "El arma se eliminó del inventario." })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const filteredWeapons = (weapons ?? []).filter(w => {
    const term = searchTerm.toLowerCase()
    const matchSearch = !searchTerm.trim() ||
      String(w.serial || "").toLowerCase().includes(term) ||    
      String(w.model || "").toLowerCase().includes(term) ||     
      String(w.assignedTo || "").toLowerCase().includes(term)
    const matchStatus = filterStatus === "TODOS" || w.status === filterStatus
    return matchSearch && matchStatus
  })

  const handleUpdateWeapon = async (id: string, data: { status?: string; assignedTo?: string }) => {
    try {
      const row = toSnakeCaseKeys(data) as Record<string, unknown>
      const { error } = await supabase.from("weapons").update(row).eq("id", id)
      if (error) throw error
      toast({ title: "Actualizado", description: "Registro de arma actualizado." })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleRegisterCheck = async (id: string) => {
    try {
      const { error } = await supabase.from("weapons").update({ last_check: nowIso() }).eq("id", id)
      if (error) throw error
      toast({ title: "Revisión registrada", description: "Fecha de última revisión actualizada." })
    } catch {
      toast({ title: "Error", description: "No se pudo registrar la revisión.", variant: "destructive" })
    }
  }

  const handleExportExcel = async () => {
    const toExport = filteredWeapons.length ? filteredWeapons : weapons || []
    const rows = toExport.map((w) => ({
      modelo: w.model || "—",
      serie: w.serial || "—",
      tipo: w.type || "—",
      estado: w.status || "—",
      asignado: w.assignedTo || "—",
      ultimaRevision: (w.lastCheck as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "—",
    }))
    const result = await exportToExcel(rows, "Armamento", [
      { header: "MODELO", key: "modelo", width: 25 },
      { header: "SERIE", key: "serie", width: 18 },
      { header: "TIPO", key: "tipo", width: 15 },
      { header: "ESTADO", key: "estado", width: 15 },
      { header: "ASIGNADO A", key: "asignado", width: 25 },
      { header: "ÚLT. REVISIÓN", key: "ultimaRevision", width: 14 },
    ], "HO_ARMAMENTO")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const toExport = filteredWeapons.length ? filteredWeapons : weapons || []
    const rows = (toExport as any[]).map((w: any) => [
      String(w.model || "—").slice(0, 20),
      String(w.serial || "—").slice(0, 15),
      w.type || "—",
      w.status || "—",
      String(w.assignedTo || "—").slice(0, 18),
      (w.lastCheck as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "—",
    ]) as (string|number)[][]
    const result = exportToPdf("ARMAMENTO", ["MODELO", "SERIE", "TIPO", "ESTADO", "ASIGNADO", "ÚLT. REVISIÓN"], rows, "HO_ARMAMENTO")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar arma del inventario?"
        description="Se borrará este registro. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            CONTROL DE ARMAMENTO
          </h1>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            INVENTARIO Y RASTREO TÁCTICO DE EQUIPO
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[140px] h-10 border-white/20 text-white bg-white/5">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="Bodega">Bodega</SelectItem>
              <SelectItem value="Asignada">Asignada</SelectItem>
              <SelectItem value="Mantenimiento">Mantenimiento</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            <FileSpreadsheet className="w-4 h-4" /> EXCEL
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            <FileDown className="w-4 h-4" /> PDF
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2 rounded shadow-lg">
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
            <div className="p-4 bg-green-600/10 rounded border border-green-600/20">
              <span className="text-[9px] font-black text-green-500 uppercase">EN BODEGA</span>
              <p className="text-3xl font-black text-white">{weapons?.filter(w => w.status === 'Bodega').length || 0}</p>
            </div>
            <div className="p-4 bg-orange-600/10 rounded border border-orange-600/20">
              <span className="text-[9px] font-black text-orange-500 uppercase">MANTENIMIENTO</span>
              <p className="text-3xl font-black text-white">{weapons?.filter(w => w.status === 'Mantenimiento').length || 0}</p>
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
                <TableHead className="text-[10px] font-black uppercase text-muted-foreground hidden md:table-cell">ÚLT. REVISIÓN</TableHead>
                <TableHead className="text-right px-6"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredWeapons.length > 0 ? (
                filteredWeapons.map((weapon) => (
                  <TableRow key={weapon.id} className="border-white/5 hover:bg-white/[0.02]">
                    <TableCell className="px-6">
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black text-white uppercase italic">{String(weapon.model)}</span>
                        <span className="text-[9px] font-mono text-primary font-bold">{String(weapon.serial)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">{String(weapon.type)}</TableCell>
                    <TableCell className="px-4">
                      <Input
                        className="h-8 w-[120px] md:w-[140px] bg-white/5 border-white/10 text-[10px] font-bold"
                        defaultValue={String(weapon.assignedTo || "")}
                        placeholder="Asignado a"
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== (weapon.assignedTo || "")) handleUpdateWeapon(weapon.id, { assignedTo: v || "" })
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={String(weapon.status)} onValueChange={(v) => handleUpdateWeapon(weapon.id, { status: v })}>
                        <SelectTrigger className="h-8 w-[120px] border-white/10 bg-white/5 text-[8px] font-black">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Bodega">Bodega</SelectItem>
                          <SelectItem value="Asignada">Asignada</SelectItem>
                          <SelectItem value="Mantenimiento">Mantenimiento</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-4 hidden md:table-cell">
                      <div className="flex items-center gap-1">
                        <span className="text-[9px] font-mono text-white/60">{(weapon.lastCheck as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "—"}</span>
                        <Button variant="ghost" size="sm" className="h-6 text-[8px] text-primary hover:text-primary" onClick={() => handleRegisterCheck(weapon.id)} title="Registrar revisión">
                          <ShieldCheck className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell className="text-right px-6">
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-white/20 hover:text-destructive" onClick={() => setDeleteId(weapon.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center text-muted-foreground/30 font-black uppercase tracking-widest text-[10px]">
                    {weapons?.length ? "Ningún arma coincide con el filtro." : "SIN REGISTROS EN INVENTARIO"}
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