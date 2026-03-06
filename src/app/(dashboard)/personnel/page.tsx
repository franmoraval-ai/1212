"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { 
  Users, 
  Search, 
  Plus, 
  Phone,
  ShieldCheck,
  Loader2,
  Trash2,
  ShieldAlert,
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
import { useToast } from "@/hooks/use-toast"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { validateStrongPassword } from "@/lib/password-policy"

export default function PersonnelPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const canManageUsers = (user?.roleLevel ?? 1) >= 4
  const canAssignL4 = (user?.email ?? "").trim().toLowerCase() === "francisco@hoseguridad.com"
  const [isOpen, setIsOpen] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterLevel, setFilterLevel] = useState<string>("TODOS")
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    temporaryPassword: "",
    role_level: "1",
    status: "Activo",
    assigned: "",
  })

  const { data: personnel, isLoading: loading } = useCollection(user ? "users" : null, { orderBy: "role_level", orderDesc: true })

  const getRoleLevel = (p: Record<string, unknown>) => Number(p.roleLevel ?? p.role_level ?? 1)

  const filteredPersonnel = (personnel ?? []).filter((p) => {
    const matchSearch = !searchTerm.trim() ||
      (String(p.firstName ?? "").toLowerCase().includes(searchTerm.toLowerCase())) ||
      (String(p.email ?? "").toLowerCase().includes(searchTerm.toLowerCase()))
    const matchLevel = filterLevel === "TODOS" || String(getRoleLevel(p as unknown as Record<string, unknown>)) === filterLevel
    return matchSearch && matchLevel
  })

  const handleAddPersonnel = async () => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede gestionar usuarios.", variant: "destructive" })
      return
    }
    if (!formData.name || !formData.email || !formData.temporaryPassword) {
      toast({ title: "Error", description: "Nombre, correo y clave temporal son obligatorios.", variant: "destructive" })
      return
    }
    const validation = validateStrongPassword(formData.temporaryPassword)
    if (!validation.ok) {
      toast({ title: "Error", description: validation.message, variant: "destructive" })
      return
    }
    if (parseInt(formData.role_level, 10) === 4 && !canAssignL4) {
      toast({ title: "Sin permisos", description: "Solo Francisco puede asignar nivel 4.", variant: "destructive" })
      return
    }

    const { data: sessionData } = await supabase.auth.getSession()
    const accessToken = sessionData.session?.access_token

    const response = await fetch("/api/personnel/create-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        name: formData.name,
        email: formData.email,
        temporaryPassword: formData.temporaryPassword,
        role_level: parseInt(formData.role_level, 10),
        status: formData.status,
        assigned: formData.assigned,
      }),
    })

    const result = (await response.json()) as { error?: string }
    if (!response.ok) {
      toast({ title: "Error", description: result.error || "No se pudo crear el usuario.", variant: "destructive" })
      return
    }

    toast({
      title: "Usuario creado",
      description: `${formData.name} fue creado con clave temporal. Debe cambiarla desde "¿Olvidó su clave táctica?".`,
    })
    setIsOpen(false)
    setFormData({ name: "", email: "", temporaryPassword: "", role_level: "1", status: "Activo", assigned: "" })
  }

  const handleUpdateRole = async (id: string, role_level: number) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede cambiar niveles.", variant: "destructive" })
      return
    }
    if (role_level === 4 && !canAssignL4) {
      toast({ title: "Sin permisos", description: "Solo Francisco puede asignar nivel 4.", variant: "destructive" })
      return
    }
    try {
      const { error } = await supabase.from("users").update({ role_level }).eq("id", id)
      if (error) throw error
      toast({ title: "Nivel actualizado", description: "El rol del usuario se actualizó correctamente." })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleUpdateStatus = async (id: string, status: string) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede cambiar estados.", variant: "destructive" })
      return
    }
    try {
      const { error } = await supabase.from("users").update({ status }).eq("id", id)
      if (error) throw error
      toast({ title: "Estado actualizado", description: "El estado se actualizó correctamente." })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleDelete = async (id: string) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede eliminar usuarios.", variant: "destructive" })
      return
    }
    setIsDeleting(true)
    try {
      const { error } = await supabase.from("users").delete().eq("id", id)
      if (error) throw error
      toast({ title: "Eliminado", description: "El personal se eliminó correctamente." })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportExcel = async () => {
    const rows = (filteredPersonnel.length ? filteredPersonnel : personnel || []).map((p) => ({
      nombre: p.firstName || "—",
      email: p.email || "—",
      nivel: `L${getRoleLevel(p as unknown as Record<string, unknown>)}`,
      estado: p.status || "—",
      asignado: p.assigned || "—",
    }))
    const result = await exportToExcel(rows, "Personal", [
      { header: "NOMBRE", key: "nombre", width: 25 },
      { header: "EMAIL", key: "email", width: 30 },
      { header: "NIVEL", key: "nivel", width: 8 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "ASIGNADO", key: "asignado", width: 20 },
    ], "HO_PERSONAL")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const toExport = filteredPersonnel.length ? filteredPersonnel : personnel || []
    const rows = toExport.map((p) => [
      String(p.firstName || "—").slice(0, 20),
      String(p.email || "—").slice(0, 28),
      `L${getRoleLevel(p as unknown as Record<string, unknown>)}`,
      String(p.status || "—"),
      String(p.assigned || "—").slice(0, 15),
    ]) as (string | number)[][]
    const result = exportToPdf("PERSONAL", ["NOMBRE", "EMAIL", "NIVEL", "ESTADO", "ASIGNADO"], rows, "HO_PERSONAL")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar personal?"
        description="Se borrará este registro de la fuerza. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <div className="scanline" />
      
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            GESTIÓN DE FUERZA
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Control de niveles y perfiles tácticos.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nombre o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-[200px] h-10 bg-white/5 border-white/20 text-white placeholder:text-white/40 text-[10px]"
          />
          <Select value={filterLevel} onValueChange={setFilterLevel}>
            <SelectTrigger className="w-[120px] h-10 border-white/20 text-white bg-white/5">
              <SelectValue placeholder="Nivel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="1">L1 Oficial</SelectItem>
              <SelectItem value="2">L2 Supervisor</SelectItem>
              <SelectItem value="3">L3 Gerente</SelectItem>
              <SelectItem value="4">L4 Director</SelectItem>
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
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2 rounded-md" disabled={!canManageUsers}>
                <Plus className="w-5 h-5 stroke-[3px]" />
                ALTA DE OFICIAL
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-md">
            <DialogHeader>
              <DialogTitle className="font-black uppercase italic text-xl">NUEVO REGISTRO</DialogTitle>
              <DialogDescription className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
                ASIGNACIÓN HALCÓN HO
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label className="text-[10px] uppercase font-black text-primary">Nombre Completo</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] uppercase font-black text-primary">Correo</Label>
                <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] uppercase font-black text-primary">Clave Temporal</Label>
                <Input
                  type="text"
                  value={formData.temporaryPassword}
                  onChange={e => setFormData({...formData, temporaryPassword: e.target.value})}
                  placeholder="Minimo 8 caracteres"
                  className="bg-white/5 border-white/10 h-11"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="grid gap-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Nivel</Label>
                  <Select onValueChange={v => setFormData({...formData, role_level: v})} defaultValue="1">
                    <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Oficial - L1</SelectItem>
                      <SelectItem value="2">Supervisor - L2</SelectItem>
                      <SelectItem value="3">Gerente - L3</SelectItem>
                      {canAssignL4 && <SelectItem value="4">Director - L4</SelectItem>}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Estado</Label>
                  <Select onValueChange={v => setFormData({...formData, status: v})} defaultValue="Activo">
                    <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="Activo">Activo</SelectItem><SelectItem value="Inactivo">Inactivo</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter className="mt-2">
              <Button onClick={handleAddPersonnel} className="w-full bg-primary text-black font-black h-12 uppercase tracking-widest">ACTIVAR CREDENCIALES</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 lg:col-span-1">
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">L4 DIRECTIVOS</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 4).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-[#1E3A8A] uppercase tracking-widest mb-1">L3 GERENTES</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 3).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-green-600 uppercase tracking-widest mb-1">L2 SUPERVISORES</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 2).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">L1 OFICIALES</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 1).length || 0}
            </div>
          </Card>
        </div>

        <Card className="lg:col-span-3 bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4 px-4 md:px-6">
            <CardTitle className="text-lg md:text-xl font-black text-white uppercase tracking-tight italic">FUERZA OPERATIVA</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-20 flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="hover:bg-transparent border-white/5">
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 md:px-6">USUARIO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 hidden md:table-cell">EMAIL</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">NIVEL</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">ESTADO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 text-right md:px-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPersonnel.length > 0 ? (
                      filteredPersonnel.map((p) => (
                        <TableRow key={p.id} className="border-white/5 hover:bg-white/[0.02] group h-20">
                          <TableCell className="px-4 md:px-6">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8 md:h-10 md:w-10 border border-white/10 bg-black">
                                <AvatarFallback className="text-primary font-black text-[10px] md:text-xs">{String(p.firstName ?? "")[0]}</AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span className="text-[11px] md:text-sm font-black text-white uppercase tracking-tight italic truncate max-w-[80px] md:max-w-none">{String(p.firstName)}</span>
                                <span className="text-[8px] font-bold text-muted-foreground uppercase md:hidden">{String(p.email)}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 hidden md:table-cell text-[10px] text-white/70 truncate max-w-[180px]">{String(p.email || "—")}</TableCell>
                          <TableCell className="px-4">
                            <Select value={String(getRoleLevel(p as unknown as Record<string, unknown>))} onValueChange={(v) => handleUpdateRole(p.id, parseInt(v, 10))} disabled={!canManageUsers}>
                              <SelectTrigger className="h-8 w-[95px] border-white/10 bg-white/5 text-[9px] font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">L1 Oficial</SelectItem>
                                <SelectItem value="2">L2 Supervisor</SelectItem>
                                <SelectItem value="3">L3 Gerente</SelectItem>
                                {canAssignL4 && <SelectItem value="4">L4 Director</SelectItem>}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="px-4">
                            <Select value={String(p.status || "Activo")} onValueChange={(v) => handleUpdateStatus(p.id, v)} disabled={!canManageUsers}>
                              <SelectTrigger className="h-8 w-[100px] border-white/10 bg-white/5 text-[9px] font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Activo">Activo</SelectItem>
                                <SelectItem value="Inactivo">Inactivo</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="text-right px-4 md:px-6">
                            <Button onClick={() => setDeleteId(p.id)} size="icon" variant="ghost" className="h-8 w-8 text-destructive/30 hover:text-destructive" disabled={!canManageUsers}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="h-64 text-center italic text-muted-foreground/30 font-black uppercase tracking-widest text-[10px]">
                          {personnel?.length ? "Ningún usuario coincide con el filtro." : "Sin registros."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}