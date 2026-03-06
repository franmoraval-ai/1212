"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { useToast } from "@/hooks/use-toast"
import { Building2, Loader2, Plus, Trash2 } from "lucide-react"
import { runMutationWithOffline } from "@/lib/offline-mutations"

type OperationCatalogRow = {
  id: string
  operationName?: string
  clientName?: string
  isActive?: boolean
}

export default function OperationsPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()

  const [formData, setFormData] = useState({
    operationName: "",
    clientName: "",
    isActive: true,
  })

  const { data: operations, isLoading, error } = useCollection<OperationCatalogRow>(
    user ? "operation_catalog" : null,
    { orderBy: "operation_name", orderDesc: false }
  )

  const activeCount = useMemo(
    () => (operations ?? []).filter((item) => item.isActive !== false).length,
    [operations]
  )

  const handleCreate = async () => {
    const operationName = formData.operationName.trim().toUpperCase()
    const clientName = formData.clientName.trim().toUpperCase()

    if (!operationName || !clientName) {
      toast({ title: "Datos incompletos", description: "Operacion y cliente son obligatorios.", variant: "destructive" })
      return
    }

    const duplicate = (operations ?? []).some(
      (item) =>
        String(item.operationName ?? "").trim().toUpperCase() === operationName &&
        String(item.clientName ?? "").trim().toUpperCase() === clientName
    )

    if (duplicate) {
      toast({ title: "Duplicado", description: "Esa operacion para ese cliente ya existe." })
      return
    }

    const row = toSnakeCaseKeys({
      operationName,
      clientName,
      isActive: formData.isActive,
      createdAt: nowIso(),
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, { table: "operation_catalog", action: "insert", payload: row })
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Operacion en cola" : "Catalogo actualizado",
      description: result.queued ? "Sin senal: se sincronizara al reconectar." : "Operacion registrada correctamente.",
    })
    setFormData({ operationName: "", clientName: "", isActive: true })
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    const result = await runMutationWithOffline(supabase, {
      table: "operation_catalog",
      action: "update",
      payload: { is_active: !current },
      match: { id },
    })

    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Cambio en cola" : "Estado actualizado",
      description: result.queued ? "Se aplicara al reconectar." : !current ? "Operacion activada." : "Operacion desactivada.",
    })
  }

  const handleDelete = async (id: string) => {
    const result = await runMutationWithOffline(supabase, { table: "operation_catalog", action: "delete", match: { id } })
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Eliminacion en cola" : "Eliminado",
      description: result.queued ? "Se eliminara al reconectar." : "Operacion eliminada del catalogo.",
    })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">CATALOGO DE OPERACIONES</h1>
        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
          Estandarizacion de nombres para incidentes y supervisiones
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-[#0c0c0c] border-white/5 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              Nueva operacion
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-white/70">Operacion</Label>
              <Input
                value={formData.operationName}
                onChange={(e) => setFormData((prev) => ({ ...prev, operationName: e.target.value }))}
                placeholder="Ej: BCR SAN JOSE"
                className="bg-black/30 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-white/70">Cliente / Puesto</Label>
              <Input
                value={formData.clientName}
                onChange={(e) => setFormData((prev) => ({ ...prev, clientName: e.target.value }))}
                placeholder="Ej: CORREOS DE CR SAN JOSE"
                className="bg-black/30 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-white/70">Estado</Label>
              <Select
                value={formData.isActive ? "ACTIVA" : "INACTIVA"}
                onValueChange={(value) => setFormData((prev) => ({ ...prev, isActive: value === "ACTIVA" }))}
              >
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVA">ACTIVA</SelectItem>
                  <SelectItem value="INACTIVA">INACTIVA</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleCreate} className="w-full bg-primary text-black font-black uppercase gap-2">
              <Plus className="w-4 h-4" /> Guardar en catalogo
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5 lg:col-span-2 overflow-hidden">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center justify-between">
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Operaciones registradas</span>
              <span className="text-[10px] text-primary">ACTIVAS: {activeCount}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <div className="p-6 text-sm text-red-400">
                No se pudo cargar `operation_catalog`. Verifique la tabla en Supabase.
              </div>
            ) : isLoading ? (
              <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !(operations ?? []).length ? (
              <div className="p-6 text-[10px] uppercase tracking-wider text-white/50">No hay operaciones registradas.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-white/[0.02] border-b border-white/5">
                    <tr>
                      <th className="px-4 py-3 text-[10px] uppercase text-white/50">Operacion</th>
                      <th className="px-4 py-3 text-[10px] uppercase text-white/50">Cliente / Puesto</th>
                      <th className="px-4 py-3 text-[10px] uppercase text-white/50">Estado</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {(operations ?? []).map((item) => {
                      const isActive = item.isActive !== false
                      return (
                        <tr key={item.id} className="border-b border-white/5">
                          <td className="px-4 py-3 text-[11px] font-black text-white uppercase">{String(item.operationName ?? "")}</td>
                          <td className="px-4 py-3 text-[10px] text-white/80 uppercase">{String(item.clientName ?? "")}</td>
                          <td className="px-4 py-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleToggleActive(item.id, isActive)}
                              className={isActive ? "border-emerald-500/40 text-emerald-400" : "border-white/20 text-white/70"}
                            >
                              {isActive ? "ACTIVA" : "INACTIVA"}
                            </Button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-white/40 hover:text-red-400"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
