"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UserPlus, Loader2, LogIn, LogOut } from "lucide-react"
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
import { useSupabase, useCollection, useUser } from "@/supabase"
import { nowIso } from "@/lib/supabase-db"
import { useToast } from "@/hooks/use-toast"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"

export default function VisitorsPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [formData, setFormData] = useState({
    name: "",
    documentId: "",
    visitedPerson: "",
  })

  const { data: visitors, isLoading } = useCollection(user ? "visitors" : null, { orderBy: "entry_time", orderDesc: true })

  const handleRegisterEntry = async () => {
    if (!formData.name.trim()) {
      toast({ title: "Error", description: "Nombre es obligatorio.", variant: "destructive" })
      return
    }
    const row = {
      name: formData.name.trim(),
      document_id: formData.documentId.trim() || null,
      visited_person: formData.visitedPerson.trim() || null,
      entry_time: nowIso(),
      exit_time: null,
    }
    const { error } = await supabase.from("visitors").insert(row)
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" })
      return
    }
    toast({ title: "Entrada registrada", description: `${formData.name} registrado.` })
    setIsOpen(false)
    setFormData({ name: "", documentId: "", visitedPerson: "" })
  }

  const handleRegisterExit = async (id: string) => {
    try {
      const { error } = await supabase.from("visitors").update({ exit_time: nowIso() }).eq("id", id)
      if (error) throw error
      toast({ title: "Salida registrada", description: "Hora de salida actualizada." })
    } catch {
      toast({ title: "Error", description: "No se pudo registrar la salida.", variant: "destructive" })
    }
  }

  const handleExportExcel = async () => {
    const rows = (visitors ?? []).map((v) => ({
      nombre: v.name || "—",
      documento: v.documentId || "—",
      aQuienVisita: v.visitedPerson || "—",
      entrada: (v.entryTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—",
      salida: (v.exitTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—",
    }))
    const result = await exportToExcel(rows, "Visitantes", [
      { header: "NOMBRE", key: "nombre", width: 25 },
      { header: "DOCUMENTO", key: "documento", width: 18 },
      { header: "A QUIÉN VISITA", key: "aQuienVisita", width: 22 },
      { header: "ENTRADA", key: "entrada", width: 20 },
      { header: "SALIDA", key: "salida", width: 20 },
    ], "HO_VISITANTES")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = (visitors ?? []).map((v) => [
      String(v.name || "—").slice(0, 22),
      String(v.documentId || "—").slice(0, 14),
      String(v.visitedPerson || "—").slice(0, 18),
      (v.entryTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—",
      (v.exitTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—",
    ])
    const result = exportToPdf("REGISTRO VISITANTES", ["NOMBRE", "DOCUMENTO", "A QUIÉN VISITA", "ENTRADA", "SALIDA"], rows, "HO_VISITANTES")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            REGISTRO DE VISITANTES
          </h1>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest opacity-60">
            Entrada y salida de visitas
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            Excel
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            PDF
          </Button>
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2">
                <UserPlus className="w-5 h-5" />
                Registrar entrada
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-[#0c0c0c] border-white/10 text-white">
              <DialogHeader>
                <DialogTitle className="text-white">Registrar entrada de visitante</DialogTitle>
                <DialogDescription className="text-muted-foreground">Nombre, documento y a quién visita.</DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label className="text-[10px] font-black uppercase text-primary">Nombre completo *</Label>
                  <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="bg-white/5 border-white/10" placeholder="Ej: Juan Pérez" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[10px] font-black uppercase text-primary">Documento de identidad</Label>
                  <Input value={formData.documentId} onChange={e => setFormData({ ...formData, documentId: e.target.value })} className="bg-white/5 border-white/10" placeholder="Cédula o pasaporte" />
                </div>
                <div className="grid gap-2">
                  <Label className="text-[10px] font-black uppercase text-primary">A quién visita</Label>
                  <Input value={formData.visitedPerson} onChange={e => setFormData({ ...formData, visitedPerson: e.target.value })} className="bg-white/5 border-white/10" placeholder="Nombre de contacto interno" />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleRegisterEntry} className="w-full bg-primary text-black font-black uppercase">
                  <LogIn className="w-4 h-4 mr-2" />
                  Registrar entrada
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="bg-[#0c0c0c]/60 border-white/5 overflow-hidden">
        <CardHeader className="pb-4 pt-6 px-6">
          <CardTitle className="text-xl font-black text-white uppercase">Visitantes</CardTitle>
          <CardDescription className="text-muted-foreground text-[10px] uppercase">Historial de entradas y salidas</CardDescription>
        </CardHeader>
        <CardContent className="px-0 md:px-6 pb-8">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/60">Nombre</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/60">Documento</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/60">A quién visita</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/60">Entrada</TableHead>
                  <TableHead className="text-[10px] font-black uppercase text-muted-foreground/60">Salida</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase text-muted-foreground/60">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </TableCell>
                  </TableRow>
                ) : visitors && visitors.length > 0 ? (
                  visitors.map((v) => (
                    <TableRow key={v.id} className="border-white/5">
                      <TableCell className="text-[10px] font-bold text-white">{String(v.name)}</TableCell>
                      <TableCell className="text-[10px] text-white/70">{String(v.documentId || "—")}</TableCell>
                      <TableCell className="text-[10px] text-white/70">{String(v.visitedPerson || "—")}</TableCell>
                      <TableCell className="text-[10px] font-mono text-white/70">{(v.entryTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—"}</TableCell>
                      <TableCell className="text-[10px] font-mono text-white/70">{(v.exitTime as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleString?.() ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        {!v.exitTime && (
                          <Button variant="outline" size="sm" className="h-8 text-[9px] border-green-500/30 text-green-400" onClick={() => handleRegisterExit(v.id)}>
                            <LogOut className="w-3 h-3 mr-1" /> Registrar salida
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-muted-foreground text-[10px] uppercase">
                      Sin registros
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
