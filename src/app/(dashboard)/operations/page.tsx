"use client"

import { useCallback, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { useToast } from "@/hooks/use-toast"
import { Building2, Loader2, Pencil, Plus, ShieldCheck, Trash2, UserRound, X } from "lucide-react"
import { runMutationWithOffline } from "@/lib/offline-mutations"

type OperationCatalogRow = {
  id: string
  operationName?: string
  clientName?: string
  isActive?: boolean
}

type StationAuthorizationOfficer = {
  id: string
  name: string
  email: string
  status: string
  assigned: string
  isAuthorized: boolean
  validFrom?: string | null
  validTo?: string | null
  notes?: string | null
}

export default function OperationsPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [appendOperationName, setAppendOperationName] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [authorizationDialogOpen, setAuthorizationDialogOpen] = useState(false)
  const [selectedAuthorizationOperation, setSelectedAuthorizationOperation] = useState<OperationCatalogRow | null>(null)
  const [authorizationOfficers, setAuthorizationOfficers] = useState<StationAuthorizationOfficer[]>([])
  const [authorizationLoading, setAuthorizationLoading] = useState(false)
  const [authorizationSaving, setAuthorizationSaving] = useState(false)
  const [authorizationError, setAuthorizationError] = useState<string | null>(null)
  const [authorizationSearch, setAuthorizationSearch] = useState("")

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

  const groupedOperations = useMemo(() => {
    const groups = new Map<string, { operationName: string; items: OperationCatalogRow[] }>()
    for (const item of operations ?? []) {
      const operationName = String(item.operationName ?? "").trim().toUpperCase() || "SIN OPERACION"
      if (!groups.has(operationName)) {
        groups.set(operationName, { operationName, items: [] })
      }
      groups.get(operationName)!.items.push(item)
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        items: [...group.items].sort((a, b) => String(a.clientName ?? "").localeCompare(String(b.clientName ?? ""))),
      }))
      .sort((a, b) => a.operationName.localeCompare(b.operationName))
  }, [operations])

  const filteredGroups = useMemo(() => {
    const query = searchTerm.trim().toUpperCase()
    if (!query) return groupedOperations
    return groupedOperations.filter((group) =>
      group.operationName.includes(query) ||
      group.items.some((item) => String(item.clientName ?? "").toUpperCase().includes(query))
    )
  }, [groupedOperations, searchTerm])

  const filteredAuthorizationOfficers = useMemo(() => {
    const query = authorizationSearch.trim().toLowerCase()
    if (!query) return authorizationOfficers
    return authorizationOfficers.filter((officer) => {
      const haystack = `${officer.name} ${officer.email} ${officer.assigned}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [authorizationOfficers, authorizationSearch])

  const authorizedCount = useMemo(
    () => authorizationOfficers.filter((officer) => officer.isAuthorized).length,
    [authorizationOfficers]
  )

  const getAuthHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = String(sessionData.session?.access_token ?? "").trim()
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = String(refreshed.session?.access_token ?? "").trim()
    }

    return {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }
  }, [supabase])

  const isDuplicateLikeError = (message: string) => {
    const normalized = String(message ?? "").toLowerCase()
    return normalized.includes("duplicate key value") || normalized.includes("already exists")
  }

  const handleCreate = async () => {
    const operationName = formData.operationName.trim().toUpperCase()
    const clientTokens = Array.from(
      new Set(
        formData.clientName
          .split(/[\n,;]+/)
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      )
    )

    if (!operationName || clientTokens.length === 0) {
      toast({ title: "Datos incompletos", description: "Operacion y cliente son obligatorios.", variant: "destructive" })
      return
    }

    if (editingId && clientTokens.length > 1) {
      toast({ title: "Edicion individual", description: "Para editar, use un solo puesto por vez.", variant: "destructive" })
      return
    }

    const existingKeys = new Set(
      (operations ?? [])
        .filter((item) => item.id !== editingId)
        .map((item) => `${String(item.operationName ?? "").trim().toUpperCase()}||${String(item.clientName ?? "").trim().toUpperCase()}`)
    )

    const uniqueClients = editingId
      ? clientTokens
      : clientTokens.filter((clientName) => !existingKeys.has(`${operationName}||${clientName}`))

    if (!editingId && uniqueClients.length === 0) {
      toast({ title: "Duplicados", description: "Todos los puestos ya existen para esa operacion." })
      return
    }

    const rowOrRows = editingId
      ? toSnakeCaseKeys({
          operationName,
          clientName: uniqueClients[0],
          isActive: formData.isActive,
        }) as Record<string, unknown>
      : uniqueClients.map((clientName) =>
          toSnakeCaseKeys({
            operationName,
            clientName,
            isActive: formData.isActive,
            createdAt: nowIso(),
          }) as Record<string, unknown>
        )

    if (editingId) {
      const result = await runMutationWithOffline(supabase, { table: "operation_catalog", action: "update", payload: rowOrRows as Record<string, unknown>, match: { id: editingId } })
      if (!result.ok) {
        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }

      toast({
        title: result.queued ? "Edicion en cola" : "Puesto actualizado",
        description: result.queued
          ? "Sin senal: se sincronizara al reconectar."
          : "Puesto operativo actualizado correctamente.",
      })
    } else {
      const rows = rowOrRows as Record<string, unknown>[]
      let inserted = 0
      let queued = 0
      let skipped = 0

      for (const row of rows) {
        const result = await runMutationWithOffline(supabase, { table: "operation_catalog", action: "insert", payload: row })
        if (result.ok) {
          if (result.queued) queued += 1
          else inserted += 1
          continue
        }

        if (isDuplicateLikeError(String(result.error ?? ""))) {
          skipped += 1
          continue
        }

        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }

      toast({
        title: queued > 0 ? "Puestos en cola" : "Centro operativo actualizado",
        description: `Nuevos: ${inserted} | En cola: ${queued} | Omitidos por duplicado: ${skipped}`,
      })
    }

    setEditingId(null)
    setAppendOperationName(null)
    setFormData({ operationName: "", clientName: "", isActive: true })
  }

  const handleStartEdit = (item: OperationCatalogRow) => {
    setEditingId(item.id)
    setAppendOperationName(null)
    setFormData({
      operationName: String(item.operationName ?? ""),
      clientName: String(item.clientName ?? ""),
      isActive: item.isActive !== false,
    })
  }

  const handlePrepareAppend = (item: OperationCatalogRow) => {
    const op = String(item.operationName ?? "").trim()
    if (!op) return
    setEditingId(null)
    setAppendOperationName(op)
    setFormData({
      operationName: op,
      clientName: "",
      isActive: item.isActive !== false,
    })
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setAppendOperationName(null)
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
      description: result.queued ? "Se eliminara al reconectar." : "Puesto eliminado del centro operativo.",
    })
  }

  const handleOpenAuthorizations = useCallback(async (item: OperationCatalogRow) => {
    setSelectedAuthorizationOperation(item)
    setAuthorizationDialogOpen(true)
    setAuthorizationLoading(true)
    setAuthorizationError(null)
    setAuthorizationSearch("")

    try {
      const headers = await getAuthHeaders()
      const response = await fetch(`/api/station-authorizations?operationCatalogId=${encodeURIComponent(item.id)}`, {
        method: "GET",
        headers,
        credentials: "include",
      })

      const result = (await response.json()) as {
        error?: string
        officers?: StationAuthorizationOfficer[]
      }

      if (!response.ok) {
        setAuthorizationOfficers([])
        setAuthorizationError(String(result.error ?? "No se pudieron cargar las autorizaciones del puesto."))
        return
      }

      setAuthorizationOfficers(Array.isArray(result.officers) ? result.officers : [])
    } catch {
      setAuthorizationOfficers([])
      setAuthorizationError("No se pudieron cargar las autorizaciones del puesto.")
    } finally {
      setAuthorizationLoading(false)
    }
  }, [getAuthHeaders])

  const handleToggleOfficerAuthorization = useCallback((officerId: string, checked: boolean) => {
    setAuthorizationOfficers((current) => current.map((officer) => (
      officer.id === officerId ? { ...officer, isAuthorized: checked } : officer
    )))
  }, [])

  const handleSaveAuthorizations = useCallback(async () => {
    if (!selectedAuthorizationOperation) return

    setAuthorizationSaving(true)
    setAuthorizationError(null)

    try {
      const headers = await getAuthHeaders()
      const authorizedOfficerIds = authorizationOfficers.filter((officer) => officer.isAuthorized).map((officer) => officer.id)
      const response = await fetch("/api/station-authorizations", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          operationCatalogId: selectedAuthorizationOperation.id,
          officerUserIds: authorizedOfficerIds,
        }),
      })

      const result = (await response.json()) as { error?: string; authorizedCount?: number }
      if (!response.ok) {
        setAuthorizationError(String(result.error ?? "No se pudieron guardar las autorizaciones del puesto."))
        return
      }

      toast({
        title: "Autorizaciones actualizadas",
        description: `${result.authorizedCount ?? authorizedOfficerIds.length} oficial(es) autorizados para este puesto.`,
      })
      setAuthorizationDialogOpen(false)
    } catch {
      setAuthorizationError("No se pudieron guardar las autorizaciones del puesto.")
    } finally {
      setAuthorizationSaving(false)
    }
  }, [authorizationOfficers, getAuthHeaders, selectedAuthorizationOperation, toast])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">CENTRO OPERATIVO</h1>
        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
          Puestos operativos, estado del puesto y oficiales autorizados
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-[#0c0c0c] border-white/5 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              {editingId ? "Editar puesto" : appendOperationName ? "Agregar puestos a operacion" : "Nueva operacion"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {appendOperationName ? (
              <p className="text-[10px] uppercase text-cyan-300 font-bold">
                Operacion seleccionada: {appendOperationName}. Se agregaran puestos nuevos y se conservaran los existentes.
              </p>
            ) : null}
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
              <Label className="text-[10px] font-black uppercase text-white/70">Puesto{editingId ? "" : " (varios)"}</Label>
              {editingId ? (
                <Input
                  value={formData.clientName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, clientName: e.target.value }))}
                  placeholder="Ej: CORREOS DE CR SAN JOSE"
                  className="bg-black/30 border-white/10"
                />
              ) : (
                <Textarea
                  value={formData.clientName}
                  onChange={(e) => setFormData((prev) => ({ ...prev, clientName: e.target.value }))}
                  placeholder="Ej: PUESTO A, PUESTO B o uno por linea"
                  className="bg-black/30 border-white/10 min-h-[90px]"
                />
              )}
              {!editingId ? (
                <p className="text-[10px] text-white/50">Puede cargar varios puestos separados por coma, punto y coma o salto de linea.</p>
              ) : null}
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

            <div className="flex gap-2">
              <Button onClick={handleCreate} className="flex-1 bg-primary text-black font-black uppercase gap-2">
                {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editingId ? "Guardar cambios" : "Guardar en centro operativo"}
              </Button>
              {editingId ? (
                <Button variant="outline" onClick={handleCancelEdit} className="border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2">
                  <X className="w-4 h-4" /> Cancelar
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5 lg:col-span-2 overflow-hidden">
          <CardHeader className="border-b border-white/5">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center justify-between">
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Puestos registrados</span>
              <span className="text-[10px] text-primary">ACTIVAS: {activeCount}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <div className="p-6 text-sm text-red-400">
                No se pudo cargar el centro operativo. Verifique `operation_catalog` en Supabase.
              </div>
            ) : isLoading ? (
              <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !(operations ?? []).length ? (
              <div className="p-6 text-[10px] uppercase tracking-wider text-white/50">No hay puestos registrados.</div>
            ) : (
              <div className="p-4 space-y-3">
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por operacion o puesto..."
                  className="bg-black/30 border-white/10"
                />

                {!filteredGroups.length ? (
                  <div className="p-4 text-[10px] uppercase tracking-wider text-white/50 border border-white/10 rounded-md">
                    No hay coincidencias con la busqueda.
                  </div>
                ) : (
                  <Accordion type="multiple" className="w-full">
                    {filteredGroups.map((group) => {
                      const activeItems = group.items.filter((item) => item.isActive !== false).length
                      const firstItem = group.items[0]

                      return (
                        <AccordionItem key={group.operationName} value={group.operationName} className="border-white/10">
                          <AccordionTrigger className="hover:no-underline px-2">
                            <div className="flex w-full items-center justify-between pr-2 gap-3">
                              <span className="text-[11px] font-black text-white uppercase text-left">{group.operationName}</span>
                              <span className="text-[10px] text-white/60 uppercase whitespace-nowrap">
                                Puestos: {group.items.length} | Activos: {activeItems}
                              </span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pt-0">
                            <div className="mb-3 px-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-cyan-400/40 text-cyan-300 hover:bg-cyan-500/10 uppercase text-[10px]"
                                onClick={() => firstItem && handlePrepareAppend(firstItem)}
                              >
                                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar puestos a esta operacion
                              </Button>
                            </div>

                            <div className="overflow-x-auto">
                              <table className="w-full text-left">
                                <thead className="bg-white/[0.02] border-y border-white/5">
                                  <tr>
                                    <th className="px-3 py-2 text-[10px] uppercase text-white/50">Puesto</th>
                                    <th className="px-3 py-2 text-[10px] uppercase text-white/50">Estado</th>
                                    <th className="px-3 py-2" />
                                  </tr>
                                </thead>
                                <tbody>
                                  {group.items.map((item) => {
                                    const isActive = item.isActive !== false
                                    return (
                                      <tr key={item.id} className="border-b border-white/5">
                                        <td className="px-3 py-2 text-[10px] text-white/80 uppercase">{String(item.clientName ?? "")}</td>
                                        <td className="px-3 py-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => handleToggleActive(item.id, isActive)}
                                            className={isActive ? "border-emerald-500/40 text-emerald-400" : "border-white/20 text-white/70"}
                                          >
                                            {isActive ? "ACTIVA" : "INACTIVA"}
                                          </Button>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-cyan-300 hover:text-cyan-200 hover:bg-cyan-500/10 mr-1 uppercase text-[10px]"
                                            onClick={() => handleOpenAuthorizations(item)}
                                            title="Autorizar oficiales"
                                          >
                                            <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Oficiales
                                          </Button>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-white/40 hover:text-primary mr-1"
                                            onClick={() => handleStartEdit(item)}
                                            title="Editar"
                                          >
                                            <Pencil className="w-4 h-4" />
                                          </Button>
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
                          </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                  </Accordion>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={authorizationDialogOpen} onOpenChange={setAuthorizationDialogOpen}>
        <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 uppercase text-sm font-black tracking-wider">
              <UserRound className="w-4 h-4 text-primary" /> Oficiales autorizados por puesto
            </DialogTitle>
            <DialogDescription className="text-white/60">
              {selectedAuthorizationOperation
                ? `${String(selectedAuthorizationOperation.operationName ?? "")} · ${String(selectedAuthorizationOperation.clientName ?? "")}`
                : "Seleccione qué oficiales pueden cubrir este puesto fijo."}
            </DialogDescription>
          </DialogHeader>

          {authorizationLoading ? (
            <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
          ) : authorizationError ? (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">{authorizationError}</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <Input
                  value={authorizationSearch}
                  onChange={(e) => setAuthorizationSearch(e.target.value)}
                  placeholder="Buscar oficial por nombre, correo o asignación..."
                  className="bg-black/30 border-white/10"
                />
                <div className="text-[10px] uppercase tracking-wider text-cyan-300 whitespace-nowrap">
                  Autorizados: {authorizedCount} / {authorizationOfficers.length}
                </div>
              </div>

              <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1">
                {!filteredAuthorizationOfficers.length ? (
                  <div className="rounded-md border border-white/10 p-4 text-[10px] uppercase tracking-wider text-white/50">
                    No hay oficiales que coincidan con la búsqueda.
                  </div>
                ) : filteredAuthorizationOfficers.map((officer) => (
                  <label key={officer.id} className="flex items-start gap-3 rounded-md border border-white/10 bg-white/[0.02] p-3 cursor-pointer">
                    <Checkbox
                      checked={officer.isAuthorized}
                      onCheckedChange={(checked) => handleToggleOfficerAuthorization(officer.id, checked === true)}
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-black uppercase text-white">{officer.name}</p>
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${officer.isAuthorized ? "bg-cyan-500/15 text-cyan-300" : "bg-white/10 text-white/50"}`}>
                          {officer.isAuthorized ? "Autorizado" : "Sin acceso"}
                        </span>
                      </div>
                      <p className="text-[11px] text-white/65">{officer.email || "Sin correo"}</p>
                      <p className="text-[10px] uppercase text-white/45 mt-1">Asignado actual: {officer.assigned || "Sin asignar"}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAuthorizationDialogOpen(false)} className="border-white/20 text-white hover:bg-white/10">
              Cerrar
            </Button>
            <Button onClick={handleSaveAuthorizations} disabled={authorizationLoading || authorizationSaving || Boolean(authorizationError)} className="bg-primary text-black font-black uppercase gap-2">
              {authorizationSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Guardar autorizaciones
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
