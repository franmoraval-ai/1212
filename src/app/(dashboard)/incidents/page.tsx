"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  CirclePlus,
  Loader2,
  ShieldAlert,
  Trash2,
  FileSpreadsheet,
  FileDown
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { TableSkeleton } from "@/components/ui/table-skeleton"
import { runMutationWithOffline } from "@/lib/offline-mutations"

export default function IncidentsPage() {
  const [description, setDescription] = useState("")
  const [type, setType] = useState("")
  const [location, setLocation] = useState("")
  const [isOpen, setIsOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [filterPriority, setFilterPriority] = useState<string>("TODOS")
  const [filterStatus, setFilterStatus] = useState<string>("TODOS")
  const { toast } = useToast()
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()

  const { data: incidents, isLoading: loading } = useCollection(user ? "incidents" : null, { orderBy: "time", orderDesc: true })

  const filteredIncidents = !incidents
    ? []
    : incidents.filter((i) => {
        const matchPriority = filterPriority === "TODOS" || i.priorityLevel === filterPriority
        const matchStatus = filterStatus === "TODOS" || (i.status ?? "Abierto") === filterStatus
        return matchPriority && matchStatus
      })

  const handleAnalyzeAndSave = async () => {
    if (!description || !type || !location) {
      toast({
        title: "Error de Validación",
        description: "Por favor complete los campos requeridos.",
        variant: "destructive"
      })
      return
    }

    try {
      const row = toSnakeCaseKeys({
        description,
        incidentType: type,
        location,
        time: nowIso(),
        priorityLevel: "Medium",
        reasoning: "Prioridad asignada manualmente",
        reportedBy: "SISTEMA TÁCTICO",
        status: "Abierto"
      }) as Record<string, unknown>

      const result = await runMutationWithOffline(supabase, { table: "incidents", action: "insert", payload: row })
      if (!result.ok) {
        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }

      toast({
        title: result.queued ? "Incidente en cola" : "Incidente Registrado",
        description: result.queued ? "Sin conexion: se enviara automaticamente al reconectar." : "El incidente ha sido guardado exitosamente.",
      })
      
      setIsOpen(false)
      setDescription("")
      setType("")
      setLocation("")
    } catch (error) {
      toast({
        title: "Error",
        description: "No se pudo guardar el incidente.",
        variant: "destructive"
      })
    }
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const result = await runMutationWithOffline(supabase, {
        table: "incidents",
        action: "update",
        payload: { status },
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Cambio en cola" : "Estado actualizado",
        description: result.queued ? "Se aplicara cuando vuelva la conexion." : `Incidente marcado como ${status}.`,
      })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar el estado.", variant: "destructive" })
    }
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const result = await runMutationWithOffline(supabase, {
        table: "incidents",
        action: "delete",
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Eliminacion en cola" : "Eliminado",
        description: result.queued ? "Se eliminara al reconectar." : "El incidente se eliminó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportExcel = async () => {
    const rows = filteredIncidents.map((i) => ({
      fecha: (i.time as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
      tipo: i.incidentType || "—",
      ubicacion: i.location || "—",
      descripcion: String(i.description ?? "").slice(0, 100),
      prioridad: i.priorityLevel || "—",
      estado: i.status ?? "Abierto",
    }))
    const result = await exportToExcel(
      rows,
      "Incidentes",
      [
        { header: "FECHA", key: "fecha", width: 15 },
        { header: "TIPO", key: "tipo", width: 25 },
        { header: "UBICACIÓN", key: "ubicacion", width: 20 },
        { header: "DESCRIPCIÓN", key: "descripcion", width: 40 },
        { header: "PRIORIDAD", key: "prioridad", width: 12 },
        { header: "ESTADO", key: "estado", width: 12 },
      ],
      "HO_INCIDENTES"
    )
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = filteredIncidents.map((i) => [
      (i.time as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
      String(i.incidentType ?? "—").slice(0, 20),
      String(i.location ?? "—").slice(0, 15),
      String(i.description ?? "—").slice(0, 40),
      i.priorityLevel || "—",
      i.status ?? "Abierto",
    ]) as (string | number)[][]
    const result = exportToPdf(
      "INCIDENTES",
      ["FECHA", "TIPO", "UBICACIÓN", "DESCRIPCIÓN", "PRIORIDAD", "ESTADO"],
      rows,
      "HO_INCIDENTES"
    )
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <div className="scanline" />
      
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            AUDITORÍA DE INCIDENTES
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Historial de novedades con análisis IA.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filterPriority} onValueChange={setFilterPriority}>
            <SelectTrigger className="w-[140px] h-10 border-white/20 text-white bg-white/5">
              <SelectValue placeholder="Prioridad" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todas</SelectItem>
              <SelectItem value="Critical">Critical</SelectItem>
              <SelectItem value="High">High</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Low">Low</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[130px] h-10 border-white/20 text-white bg-white/5">
              <SelectValue placeholder="Estado" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="Abierto">Abierto</SelectItem>
              <SelectItem value="En curso">En curso</SelectItem>
              <SelectItem value="Cerrado">Cerrado</SelectItem>
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
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2 rounded-md">
                <CirclePlus className="w-5 h-5 stroke-[3px]" />
                NUEVO REPORTE
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-[#0c0c0c] border-white/10 text-white w-[95vw] md:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl font-black uppercase italic tracking-tighter">Reporte Táctico</DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs uppercase font-bold">
                Análisis inmediato de seguridad.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 md:gap-6 py-4">
              <div className="grid gap-2">
                <Label htmlFor="type" className="text-[10px] font-black uppercase tracking-widest text-primary">Tipo de Incidente</Label>
                <Input 
                  id="type" 
                  placeholder="Ej: Acceso no autorizado" 
                  className="bg-black/50 border-white/10 h-11" 
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="location" className="text-[10px] font-black uppercase tracking-widest text-primary">Ubicación</Label>
                <Input 
                  id="location" 
                  placeholder="Ej: Sector 4" 
                  className="bg-black/50 border-white/10 h-11"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="desc" className="text-[10px] font-black uppercase tracking-widest text-primary">Descripción</Label>
                <Textarea 
                  id="desc" 
                  placeholder="Detalle los hechos..." 
                  className="bg-black/50 border-white/10 min-h-[100px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button 
                onClick={handleAnalyzeAndSave} 
                className="w-full bg-primary text-black font-black uppercase text-xs h-12"
              >
                <ShieldAlert className="w-4 h-4 mr-2" />
                GUARDAR INCIDENTE
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar incidente?"
        description="Se borrará este registro de incidentes. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />

      <Card className="bg-[#0c0c0c]/60 border-white/5 shadow-2xl overflow-hidden backdrop-blur-sm">
        <CardHeader className="pb-4 md:pb-6 pt-6 md:pt-10 px-6 md:px-10">
          <CardTitle className="text-xl md:text-2xl font-black text-white uppercase tracking-tight">
            INCIDENTES
          </CardTitle>
          <CardDescription className="text-muted-foreground text-[10px] font-bold opacity-60 tracking-tight uppercase">
            Registro de fuerza operativa.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-10 pb-8 md:pb-16">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="border-none">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">FECHA</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">TIPO / DESC</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">NIVEL</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">ESTADO</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 text-right"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableSkeleton rows={6} cols={5} />
                ) : filteredIncidents.length > 0 ? (
                  filteredIncidents.map((incident) => (
                    <TableRow key={incident.id} className="border-white/5 hover:bg-white/[0.02] h-20">
                      <TableCell className="text-[10px] font-mono text-white/70 px-4">
                        {(incident.time as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "Pendiente"}
                      </TableCell>
                      <TableCell className="px-4">
                        <div className="flex flex-col">
                          <span className="text-[10px] md:text-xs font-black uppercase text-white italic truncate max-w-[100px] md:max-w-none">{String(incident.incidentType)}</span>
                          <span className="text-[9px] text-muted-foreground line-clamp-1 max-w-[100px] md:max-w-none">{String(incident.description)}</span>
                        </div>
                      </TableCell>
                      <TableCell className="px-4">
                        <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                          incident.priorityLevel === 'Critical' ? 'bg-red-500 text-white' :
                          incident.priorityLevel === 'High' ? 'bg-orange-500 text-white' :
                          incident.priorityLevel === 'Medium' ? 'bg-yellow-500 text-black' :
                          'bg-blue-500 text-white'
                        }`}>
                          {String(incident.priorityLevel)}
                        </span>
                      </TableCell>
                      <TableCell className="px-4">
                        <Select value={String(incident.status ?? "Abierto")} onValueChange={(v) => handleStatusChange(incident.id, v)}>
                          <SelectTrigger className="h-8 w-[110px] border-white/10 bg-white/5 text-[9px] font-bold">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Abierto">Abierto</SelectItem>
                            <SelectItem value="En curso">En curso</SelectItem>
                            <SelectItem value="Cerrado">Cerrado</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-right px-4">
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive/50 hover:text-destructive"
                          onClick={() => setDeleteId(incident.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow className="border-none hover:bg-transparent">
                    <TableCell colSpan={5} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center space-y-4">
                        <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 italic">
                          No hay incidentes.
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
