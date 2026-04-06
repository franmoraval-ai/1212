"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { useOperationCatalogData } from "@/hooks/use-operation-catalog-data"
import { useSupabase, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { useToast } from "@/hooks/use-toast"
import { fetchInternalApi } from "@/lib/internal-api"
import { Building2, Cpu, Loader2, Pencil, Plus, RadioTower, ShieldCheck, Trash2, UserRound, Users, X } from "lucide-react"

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

type StationProfileRecord = {
  id: string
  operationCatalogId: string
  operationName: string
  postName: string
  catalogIsActive: boolean
  isEnabled: boolean
  deviceLabel?: string | null
  notes?: string | null
  registeredAt?: string | null
  updatedAt?: string | null
}

type OperationCatalogMutationResult = {
  ok: boolean
  status: number
  error?: string
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
  const [stationProfiles, setStationProfiles] = useState<StationProfileRecord[]>([])
  const [stationProfilesLoading, setStationProfilesLoading] = useState(false)
  const [stationProfilesError, setStationProfilesError] = useState<string | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [selectedProfileOperation, setSelectedProfileOperation] = useState<OperationCatalogRow | null>(null)
  const [profileEnabled, setProfileEnabled] = useState(true)
  const [profileDeviceLabel, setProfileDeviceLabel] = useState("")
  const [profileNotes, setProfileNotes] = useState("")
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    operationName: "",
    clientName: "",
    isActive: true,
  })

  const { operations, isLoading, error, reload } = useOperationCatalogData()

  const activeCount = useMemo(
    () => (operations ?? []).filter((item) => item.isActive !== false).length,
    [operations]
  )

  const operationCount = useMemo(() => new Set((operations ?? []).map((item) => String(item.operationName ?? "").trim().toUpperCase()).filter(Boolean)).size, [operations])
  const totalPosts = operations?.length ?? 0
  const stationProfilesMap = useMemo(() => new Map(stationProfiles.map((profile) => [profile.operationCatalogId, profile])), [stationProfiles])
  const enabledProfilesCount = useMemo(() => stationProfiles.filter((profile) => profile.isEnabled).length, [stationProfiles])

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

  const fetchWithAuthRetry = useCallback(async (input: string, init: RequestInit) => {
    return fetchInternalApi(supabase, input, init)
  }, [supabase])

  const mutateOperationCatalog = useCallback(async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>): Promise<OperationCatalogMutationResult> => {
    try {
      const response = await fetchWithAuthRetry("/api/operation-catalog", {
        method,
        body: JSON.stringify(body),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      return {
        ok: response.ok,
        status: response.status,
        error: response.ok ? undefined : String(result.error ?? "No se pudo guardar el catálogo operativo."),
      }
    } catch {
      return {
        ok: false,
        status: 0,
        error: "No se pudo guardar el catálogo operativo.",
      }
    }
  }, [fetchWithAuthRetry])

  const loadProfiles = useCallback(async () => {
    setStationProfilesLoading(true)
    setStationProfilesError(null)
    try {
      const response = await fetchWithAuthRetry("/api/station-profiles", {
        method: "GET",
      })
      const result = (await response.json()) as { error?: string; profiles?: StationProfileRecord[] }
      if (!response.ok) {
        setStationProfiles([])
        setStationProfilesError(String(result.error ?? "No se pudieron cargar los registros L1 operativos."))
        return
      }
      setStationProfiles(Array.isArray(result.profiles) ? result.profiles : [])
    } catch {
      setStationProfiles([])
      setStationProfilesError("No se pudieron cargar los registros L1 operativos.")
    } finally {
      setStationProfilesLoading(false)
    }
  }, [fetchWithAuthRetry])

  useEffect(() => {
    if (!user) return
    void loadProfiles()
  }, [loadProfiles, user])

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
      const payload = rowOrRows as Record<string, unknown>
      const result = await mutateOperationCatalog("PATCH", {
        id: editingId,
        operationName: payload.operation_name,
        clientName: payload.client_name,
        isActive: payload.is_active,
      })
      if (!result.ok) {
        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }

      toast({
        title: "Puesto actualizado",
        description: "Puesto operativo actualizado correctamente.",
      })
      void reload(false)
    } else {
      const rows = rowOrRows as Record<string, unknown>[]
      let inserted = 0
      let skipped = 0

      for (const row of rows) {
        const result = await mutateOperationCatalog("POST", {
          operationName: row.operation_name,
          clientName: row.client_name,
          isActive: row.is_active,
          createdAt: row.created_at,
        })
        if (result.ok) {
          inserted += 1
          continue
        }

        if (result.status === 409 || isDuplicateLikeError(String(result.error ?? ""))) {
          skipped += 1
          continue
        }

        toast({ title: "Error", description: result.error, variant: "destructive" })
        return
      }

      toast({
        title: "Centro operativo actualizado",
        description: `Nuevos: ${inserted} | Omitidos por duplicado: ${skipped}`,
      })
      if (inserted > 0 || skipped > 0) void reload(false)
    }

    setEditingId(null)
    setAppendOperationName(null)
    setFormData({ operationName: "", clientName: "", isActive: true })
    void loadProfiles()
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
    const target = operations?.find((item) => item.id === id)
    if (!target) {
      toast({ title: "Error", description: "No se pudo resolver el puesto a actualizar.", variant: "destructive" })
      return
    }

    const result = await mutateOperationCatalog("PATCH", {
      id,
      operationName: target.operationName,
      clientName: target.clientName,
      isActive: !current,
    })

    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: "Estado actualizado",
      description: !current ? "Operacion activada." : "Operacion desactivada.",
    })
    void reload(false)
  }

  const handleDelete = async (id: string) => {
    const result = await mutateOperationCatalog("DELETE", { id })
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: "Eliminado",
      description: "Puesto eliminado del centro operativo.",
    })
    void reload(false)
  }

  const handleOpenAuthorizations = useCallback(async (item: OperationCatalogRow) => {
    setSelectedAuthorizationOperation(item)
    setAuthorizationDialogOpen(true)
    setAuthorizationLoading(true)
    setAuthorizationError(null)
    setAuthorizationSearch("")

    try {
      const response = await fetchWithAuthRetry(`/api/station-authorizations?operationCatalogId=${encodeURIComponent(item.id)}`, {
        method: "GET",
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
  }, [fetchWithAuthRetry])

  const handleOpenProfileDialog = useCallback((item: OperationCatalogRow) => {
    const existing = stationProfilesMap.get(String(item.id ?? ""))
    setSelectedProfileOperation(item)
    setProfileEnabled(existing?.isEnabled ?? item.isActive !== false)
    setProfileDeviceLabel(String(existing?.deviceLabel ?? "").trim())
    setProfileNotes(String(existing?.notes ?? "").trim())
    setProfileError(null)
    setProfileDialogOpen(true)
  }, [stationProfilesMap])

  const handleSaveProfile = useCallback(async () => {
    if (!selectedProfileOperation?.id) return
    setProfileSaving(true)
    setProfileError(null)
    try {
      const response = await fetchWithAuthRetry("/api/station-profiles", {
        method: "POST",
        body: JSON.stringify({
          operationCatalogId: selectedProfileOperation.id,
          isEnabled: profileEnabled,
          deviceLabel: profileDeviceLabel,
          notes: profileNotes,
        }),
      })
      const result = (await response.json()) as { error?: string; profile?: StationProfileRecord | null }
      if (!response.ok) {
        setProfileError(String(result.error ?? "No se pudo guardar el registro L1 operativo."))
        return
      }
      toast({
        title: "L1 operativo actualizado",
        description: profileEnabled ? "El puesto quedó habilitado para operación L1." : "El puesto quedó pausado en L1 operativo.",
      })
      setStationProfiles((current) => {
        const next = (result.profile?.id ? [result.profile, ...current.filter((profile) => profile.operationCatalogId !== result.profile?.operationCatalogId)] : current)
        return next.sort((left, right) => {
          const byOperation = left.operationName.localeCompare(right.operationName, "es", { sensitivity: "base" })
          if (byOperation !== 0) return byOperation
          return left.postName.localeCompare(right.postName, "es", { sensitivity: "base" })
        })
      })
      setProfileDialogOpen(false)
    } catch {
      setProfileError("No se pudo guardar el registro L1 operativo.")
    } finally {
      setProfileSaving(false)
    }
  }, [fetchWithAuthRetry, profileDeviceLabel, profileEnabled, profileNotes, selectedProfileOperation, toast])

  const handleToggleOfficerAuthorization = useCallback((officerId: string, checked: boolean) => {
    setAuthorizationError(null)
    setAuthorizationOfficers((current) => current.map((officer) => (
      officer.id === officerId ? { ...officer, isAuthorized: checked } : officer
    )))
  }, [])

  const handleSaveAuthorizations = useCallback(async () => {
    if (!selectedAuthorizationOperation) return

    setAuthorizationSaving(true)
    setAuthorizationError(null)

    try {
      const authorizedOfficerIds = authorizationOfficers.filter((officer) => officer.isAuthorized).map((officer) => officer.id)
      const response = await fetchWithAuthRetry("/api/station-authorizations", {
        method: "POST",
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
  }, [authorizationOfficers, fetchWithAuthRetry, selectedAuthorizationOperation, toast])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">PUESTOS OPERATIVOS</h1>
          <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
            Aquí se crean los puestos fijos y se autoriza qué oficiales pueden laborar en cada uno.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
          <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">PUESTOS TOTALES</p>
          <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{totalPosts}</p>
        </Card>
        <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
          <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">PUESTOS ACTIVOS</p>
          <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{activeCount}</p>
        </Card>
        <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
          <p className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">OPERACIONES</p>
          <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{operationCount}</p>
        </Card>
        <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
          <p className="text-[9px] font-black text-amber-300 uppercase tracking-widest mb-1">L1 OPERATIVO</p>
          <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{stationProfilesLoading ? "..." : enabledProfilesCount}</p>
          <p className="text-xs text-white/65 leading-5 mt-2">Registrados: {stationProfiles.length}. Active o pause el puesto desde su ficha L1.</p>
        </Card>
      </div>

      {stationProfilesError ? (
        <div className="rounded border border-amber-400/20 bg-amber-400/10 p-4 text-[11px] uppercase tracking-wide text-amber-100">
          {stationProfilesError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-[#0c0c0c] border-white/5 lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-primary" />
              {editingId ? "Editar puesto" : appendOperationName ? "Agregar puestos a operación" : "Crear puesto"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {appendOperationName ? (
              <p className="text-[10px] uppercase text-cyan-300 font-bold">
                Operación seleccionada: {appendOperationName}. Se agregarán puestos nuevos y se conservarán los existentes.
              </p>
            ) : null}
            <div className="space-y-1.5">
              <Label className="text-[10px] font-black uppercase text-white/70">Operación madre</Label>
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
                <p className="text-[10px] text-white/50">Puede crear varios puestos a la vez separados por coma, punto y coma o salto de línea.</p>
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
                {editingId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {editingId ? "Guardar cambios" : "Guardar puesto"}
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
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-primary" /> Mapa de puestos</span>
              <span className="text-[10px] text-primary">ACTIVOS: {activeCount}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <div className="p-6 text-sm text-red-400">
                No se pudieron cargar los puestos. Verifique `operation_catalog` en Supabase.
              </div>
            ) : isLoading ? (
              <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : !(operations ?? []).length ? (
              <div className="p-6 text-[10px] uppercase tracking-wider text-white/50">No hay puestos registrados todavía.</div>
            ) : (
              <div className="p-4 space-y-3">
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar por operación o puesto..."
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
                                <Plus className="w-3.5 h-3.5 mr-1" /> Agregar puestos a esta operación
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
                                          <div className="flex flex-wrap gap-2">
                                            <Button
                                              variant="outline"
                                              size="sm"
                                              onClick={() => handleToggleActive(item.id, isActive)}
                                              className={isActive ? "border-emerald-500/40 text-emerald-400" : "border-white/20 text-white/70"}
                                            >
                                              {isActive ? "ACTIVA" : "INACTIVA"}
                                            </Button>
                                            {(() => {
                                              const stationProfile = stationProfilesMap.get(String(item.id ?? ""))
                                              return (
                                                <span className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-black uppercase ${stationProfile?.isEnabled ? "bg-cyan-400/15 text-cyan-200" : "bg-white/10 text-white/55"}`}>
                                                  <RadioTower className="w-3 h-3 mr-1" /> {stationProfile?.isEnabled ? "L1 activo" : "L1 pausado"}
                                                </span>
                                              )
                                            })()}
                                          </div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                          <Button
                                            variant="ghost"
                                            size="sm"
                                            className="h-8 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10 mr-1 uppercase text-[10px]"
                                            onClick={() => handleOpenProfileDialog(item)}
                                            title="Registro L1 operativo"
                                          >
                                            <Cpu className="w-3.5 h-3.5 mr-1" /> L1
                                          </Button>
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
              <Users className="w-4 h-4 text-primary" /> Oficiales autorizados por puesto
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
            <Button onClick={handleSaveAuthorizations} disabled={authorizationLoading || authorizationSaving} className="bg-primary text-black font-black uppercase gap-2">
              {authorizationSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />} Guardar autorizaciones
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 uppercase text-sm font-black tracking-wider">
              <Cpu className="w-4 h-4 text-primary" /> Registro L1 operativo
            </DialogTitle>
            <DialogDescription className="text-white/60">
              {selectedProfileOperation
                ? `${String(selectedProfileOperation.operationName ?? "")} · ${String(selectedProfileOperation.clientName ?? "")}`
                : "Configure la identidad operativa L1 del puesto."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-4 space-y-2">
              <p className="text-[10px] uppercase font-black tracking-widest text-cyan-200">Registro operativo</p>
              <p className="text-xs text-white/80 leading-5">
                Este registro convierte el puesto del catálogo en una entidad L1 operativa independiente del oficial que tome turno.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-black text-white/70">Estado L1 operativo</Label>
              <Select value={profileEnabled ? "ACTIVO" : "PAUSADO"} onValueChange={(value) => setProfileEnabled(value === "ACTIVO")}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVO">ACTIVO</SelectItem>
                  <SelectItem value="PAUSADO">PAUSADO</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-black text-white/70">Etiqueta del dispositivo</Label>
              <Input
                value={profileDeviceLabel}
                onChange={(event) => setProfileDeviceLabel(event.target.value)}
                placeholder="Ej: TABLET PUESTO NORTE"
                className="bg-black/30 border-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase font-black text-white/70">Notas de despliegue</Label>
              <Textarea
                value={profileNotes}
                onChange={(event) => setProfileNotes(event.target.value)}
                placeholder="Indicaciones del dispositivo, turnos o despliegue L1"
                className="bg-black/30 border-white/10 min-h-[100px]"
              />
            </div>

            {profileError ? <p className="text-[10px] uppercase text-amber-300 font-black">{profileError}</p> : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileDialogOpen(false)} className="border-white/20 text-white hover:bg-white/10">
              Cerrar
            </Button>
            <Button onClick={handleSaveProfile} disabled={profileSaving || !selectedProfileOperation?.id} className="bg-primary text-black font-black uppercase gap-2">
              {profileSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Cpu className="w-4 h-4" />} Guardar L1 operativo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
