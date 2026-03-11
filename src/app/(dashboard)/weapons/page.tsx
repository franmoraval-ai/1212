"use client"

import { useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
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
  FileDown,
  Upload,
  Layers
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
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import type { Worksheet } from "exceljs"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)

type ImportedWeapon = {
  model: string
  serial: string
  type: string
  status: string
  assignedTo: string
  location: { lat: number; lng: number }
}

const DEFAULT_LOCATION = { lat: 9.9281, lng: -84.0907 }

function normalizeHeader(value: unknown) {
  return toText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function toText(value: unknown) {
  if (value && typeof value === "object") {
    const candidate = value as {
      text?: string
      result?: string | number
      richText?: Array<{ text?: string }>
    }
    if (typeof candidate.text === "string") return candidate.text.trim()
    if (typeof candidate.result === "string" || typeof candidate.result === "number") return String(candidate.result).trim()
    if (Array.isArray(candidate.richText)) {
      return candidate.richText.map((part) => String(part.text ?? "")).join("").trim()
    }
  }
  return String(value ?? "").trim()
}

function toStatus(rawStatus: unknown, assignedTo?: string) {
  const status = toText(rawStatus).toLowerCase()
  const assigned = String(assignedTo ?? "").toLowerCase()
  const context = `${status} ${assigned}`
  if (context.includes("robad")) return "Robada"
  if (context.includes("manten")) return "Mantenimiento"
  if (context.includes("asign")) return "Asignada"
  if (assigned && !context.includes("armeri") && !context.includes("bodega")) return "Asignada"
  return "Bodega"
}

function toWeaponType(value: unknown) {
  const raw = toText(value).toLowerCase()
  if (raw.includes("revol")) return "Revolver"
  if (raw.includes("escop")) return "Escopeta"
  return "Pistola"
}

export default function WeaponsPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const excelInputRef = useRef<HTMLInputElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterStatus, setFilterStatus] = useState<string>("TODOS")
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  
  const [formData, setFormData] = useState({
    model: "",
    serial: "",
    type: "Pistola",
    status: "Bodega",
    assignedTo: "",
    location: DEFAULT_LOCATION,
    ammoCount: 0,
  })

  const { data: weapons, isLoading: loading } = useCollection(user ? "weapons" : null, {
    orderBy: "serial",
    orderDesc: false,
    realtime: false,
    pollingMs: 120000,
  })

  const handleAddWeapon = async () => {
    if (!formData.model || !formData.serial) {
      toast({ title: "Error", description: "Modelo y serie son obligatorios.", variant: "destructive" })
      return
    }
    
    const row = toSnakeCaseKeys({ ...formData, lastCheck: nowIso() }) as Record<string, unknown>
    const result = await runMutationWithOffline(supabase, { table: "weapons", action: "insert", payload: row })
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    toast({
      title: result.queued ? "Registro en cola" : "Arma Registrada",
      description: result.queued ? "Sin senal: se sincronizara al reconectar." : `Serie ${formData.serial} ingresada al inventario.`,
    })
    setIsOpen(false)
    setFormData({ model: "", serial: "", type: "Pistola", status: "Bodega", assignedTo: "", location: DEFAULT_LOCATION })
      setFormData({ model: "", serial: "", type: "Pistola", status: "Bodega", assignedTo: "", ammoCount: 0, location: DEFAULT_LOCATION })
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const result = await runMutationWithOffline(supabase, { table: "weapons", action: "delete", match: { id } })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Eliminacion en cola" : "Eliminado",
        description: result.queued ? "Se eliminara al reconectar." : "El arma se eliminó del inventario.",
      })
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
    const handleUpdateWeapon = async (id: string, data: { status?: string; assignedTo?: string; ammoCount?: number }) => {
    try {
      const row = toSnakeCaseKeys(data) as Record<string, unknown>
      const result = await runMutationWithOffline(supabase, {
        table: "weapons",
        action: "update",
        payload: row,
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Cambio en cola" : "Actualizado",
        description: result.queued ? "Se aplicara al reconectar." : "Registro de arma actualizado.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleRegisterCheck = async (id: string) => {
    try {
      const result = await runMutationWithOffline(supabase, {
        table: "weapons",
        action: "update",
        payload: { last_check: nowIso() },
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Revision en cola" : "Revisión registrada",
        description: result.queued ? "Se aplicara al reconectar." : "Fecha de última revisión actualizada.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo registrar la revisión.", variant: "destructive" })
    }
  }

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const toExport = filteredWeapons.length ? filteredWeapons : weapons || []
    const rows = toExport.map((w) => ({
      modelo: w.model || "—",
      serie: w.serial || "—",
      tipo: w.type || "—",
      estado: w.status || "—",
      asignado: w.assignedTo || "—",
      municiones: w.ammoCount ?? "—",
      ultimaRevision: (w.lastCheck as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "—",
    }))
    const result = await exportToExcel(rows, "Armamento", [
      { header: "MODELO", key: "modelo", width: 25 },
      { header: "SERIE", key: "serie", width: 18 },
      { header: "TIPO", key: "tipo", width: 15 },
      { header: "ESTADO", key: "estado", width: 15 },
      { header: "ASIGNADO A", key: "asignado", width: 25 },
      { header: "MUNICIONES", key: "municiones", width: 12 },
      { header: "ÚLT. REVISIÓN", key: "ultimaRevision", width: 14 },
    ], "HO_ARMAMENTO")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const toExport = filteredWeapons.length ? filteredWeapons : weapons || []
    const rows = (toExport as any[]).map((w: any) => [
      String(w.model || "—").slice(0, 20),
      String(w.serial || "—").slice(0, 15),
      w.type || "—",
      w.status || "—",
      String(w.assignedTo || "—").slice(0, 18),
      w.ammoCount ?? "—",
      (w.lastCheck as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "—",
    ]) as (string|number)[][]
    const result = await exportToPdf("ARMAMENTO", ["MODELO", "SERIE", "TIPO", "ESTADO", "ASIGNADO", "MUNICIONES", "ÚLT. REVISIÓN"], rows, "HO_ARMAMENTO")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const groupedByType = useMemo(() => {
    const source = filteredWeapons.length ? filteredWeapons : weapons || []
    const groups = new Map<string, number>()
    source.forEach((w) => {
      const key = String(w.type || "Sin tipo")
      groups.set(key, (groups.get(key) ?? 0) + 1)
    })
    return Array.from(groups.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filteredWeapons, weapons])

  const groupedByStatus = useMemo(() => {
    const source = filteredWeapons.length ? filteredWeapons : weapons || []
    const groups = new Map<string, number>()
    source.forEach((w) => {
      const key = String(w.status || "Sin estado")
      groups.set(key, (groups.get(key) ?? 0) + 1)
    })
    return Array.from(groups.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
  }, [filteredWeapons, weapons])

  const handleImportExcel = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!/\.xlsx$/i.test(file.name)) {
      toast({ title: "Formato inválido", description: "Sube un archivo .xlsx", variant: "destructive" })
      event.target.value = ""
      return
    }

    setIsImporting(true)
    try {
      const ExcelJS = (await import("exceljs")).default
      const buffer = await file.arrayBuffer()
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(buffer)
      if (!workbook.worksheets.length) {
        throw new Error("El archivo no contiene hojas.")
      }

      const brandKeys = new Set(["marca", "brand", "fabricante"])
      const modelKeys = new Set(["modelo", "model", "arma", "descripcion", "descripcioniarma"])
      const caliberKeys = new Set(["calibre", "caliber"])
      const serialKeys = new Set(["serie", "serial", "numerodeserie", "numerodeseriearma", "noserie", "nserie", "numero", "numeracion"])
      const typeKeys = new Set(["tipo", "type", "categoria", "clase"])
      const statusKeys = new Set(["estado", "status", "situacion"])
      const assignedKeys = new Set(["asignado", "asignadoa", "responsable", "oficial", "encargado", "puesto", "post", "ubicacion", "ubicacionactual"])
      const latKeys = new Set(["lat", "latitude", "latitud"])
      const lngKeys = new Set(["lng", "lon", "long", "longitude", "longitud"])

      const detectHeaderInWorksheet = (worksheet: Worksheet) => {
        const maxRows = Math.min(worksheet.rowCount || 0, 20)
        for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
          const row = worksheet.getRow(rowNumber)
          const headers = row.values as Array<unknown>
          const indexByField = {
            brand: -1,
            model: -1,
            caliber: -1,
            serial: -1,
            type: -1,
            status: -1,
            assignedTo: -1,
            lat: -1,
            lng: -1,
          }

          for (let i = 1; i < headers.length; i++) {
            const normalized = normalizeHeader(headers[i])
            if (!normalized) continue
            if (indexByField.brand === -1 && brandKeys.has(normalized)) indexByField.brand = i
            if (indexByField.model === -1 && modelKeys.has(normalized)) indexByField.model = i
            if (indexByField.caliber === -1 && caliberKeys.has(normalized)) indexByField.caliber = i
            if (indexByField.serial === -1 && serialKeys.has(normalized)) indexByField.serial = i
            if (indexByField.type === -1 && typeKeys.has(normalized)) indexByField.type = i
            if (indexByField.status === -1 && statusKeys.has(normalized)) indexByField.status = i
            if (indexByField.assignedTo === -1 && assignedKeys.has(normalized)) indexByField.assignedTo = i
            if (indexByField.lat === -1 && latKeys.has(normalized)) indexByField.lat = i
            if (indexByField.lng === -1 && lngKeys.has(normalized)) indexByField.lng = i
          }

          // Soporte explícito para plantilla: TIPO | MARCA | MODELO | CALIBRE | NUMERO DE SERIE | PUESTO
          if (
            indexByField.type === -1 &&
            indexByField.brand === -1 &&
            indexByField.model === -1 &&
            indexByField.caliber === -1 &&
            indexByField.serial === -1 &&
            indexByField.assignedTo === -1
          ) {
            const normalizedHeaders = headers.map((h) => normalizeHeader(h))
            const tipoIndex = normalizedHeaders.findIndex((h) => h === "tipo")
            const marcaIndex = normalizedHeaders.findIndex((h) => h === "marca")
            const modeloIndex = normalizedHeaders.findIndex((h) => h === "modelo")
            const calibreIndex = normalizedHeaders.findIndex((h) => h === "calibre")
            const serieIndex = normalizedHeaders.findIndex((h) => h === "numerodeserie" || h === "serie" || h === "serial")
            const puestoIndex = normalizedHeaders.findIndex((h) => h === "puesto")
            if (tipoIndex > 0 && marcaIndex > 0 && modeloIndex > 0 && serieIndex > 0) {
              indexByField.type = tipoIndex
              indexByField.brand = marcaIndex
              indexByField.model = modeloIndex
              indexByField.caliber = calibreIndex > 0 ? calibreIndex : -1
              indexByField.serial = serieIndex
              indexByField.assignedTo = puestoIndex > 0 ? puestoIndex : -1
            }
          }

          const hasSerial = indexByField.serial !== -1
          const hasIdentityColumn = indexByField.model !== -1 || indexByField.brand !== -1 || indexByField.type !== -1
          if (hasSerial && hasIdentityColumn) {
            return { rowNumber, indexByField }
          }
        }
        return null
      }

      let selectedWorksheet: Worksheet | null = null
      let headerRowNumber = -1
      let indexByField: {
        brand: number
        model: number
        caliber: number
        serial: number
        type: number
        status: number
        assignedTo: number
        lat: number
        lng: number
      } | null = null

      for (const ws of workbook.worksheets) {
        const detected = detectHeaderInWorksheet(ws)
        if (detected) {
          selectedWorksheet = ws
          headerRowNumber = detected.rowNumber
          indexByField = detected.indexByField
          break
        }
      }

      if (!selectedWorksheet || !indexByField) {
        throw new Error("No se encontraron encabezados válidos (serie/modelo/tipo) en el Excel.")
      }

      const imported: ImportedWeapon[] = []
      const serialSeen = new Set<string>()

      const rows = selectedWorksheet.rowCount
      for (let rowNumber = headerRowNumber + 1; rowNumber <= rows; rowNumber++) {
        const row = selectedWorksheet.getRow(rowNumber)
        const brand = toText(indexByField.brand > 0 ? row.getCell(indexByField.brand).value : "")
        const baseModel = toText(indexByField.model > 0 ? row.getCell(indexByField.model).value : "")
        const caliber = toText(indexByField.caliber > 0 ? row.getCell(indexByField.caliber).value : "")
        const serial = toText(indexByField.serial > 0 ? row.getCell(indexByField.serial).value : "")
        if (!serial) continue

        const model = [brand, baseModel, caliber ? `CAL ${caliber}` : ""].filter(Boolean).join(" ") || "SIN MODELO"

        const serialKey = serial.toLowerCase()
        if (serialSeen.has(serialKey)) continue
        serialSeen.add(serialKey)

        const assignedTo = toText(indexByField.assignedTo > 0 ? row.getCell(indexByField.assignedTo).value : "")
        const type = toWeaponType(indexByField.type > 0 ? row.getCell(indexByField.type).value : "")
        const status = toStatus(indexByField.status > 0 ? row.getCell(indexByField.status).value : "", assignedTo)

        const latValue = Number(toText(indexByField.lat > 0 ? row.getCell(indexByField.lat).value : ""))
        const lngValue = Number(toText(indexByField.lng > 0 ? row.getCell(indexByField.lng).value : ""))

        imported.push({
          model,
          serial,
          type,
          status,
          assignedTo,
          location: {
            lat: Number.isFinite(latValue) ? latValue : DEFAULT_LOCATION.lat,
            lng: Number.isFinite(lngValue) ? lngValue : DEFAULT_LOCATION.lng,
          },
        })
      }

      if (!imported.length) {
        throw new Error("No se encontraron filas con número de serie válido para importar.")
      }

      const existingSerials = new Set((weapons || []).map((w) => String(w.serial || "").toLowerCase()))
      const newRows = imported.filter((w) => !existingSerials.has(w.serial.toLowerCase()))

      if (!newRows.length) {
        toast({ title: "Sin cambios", description: "Todas las series ya existen en inventario." })
        return
      }

      const payload = newRows.map((w) => toSnakeCaseKeys({ ...w, lastCheck: nowIso() })) as Record<string, unknown>[]
      const result = await runMutationWithOffline(supabase, { table: "weapons", action: "insert", payload })
      if (!result.ok) throw new Error(result.error)

      toast({
        title: result.queued ? "Importacion en cola" : "Importación completada",
        description: result.queued
          ? `Sin senal: ${newRows.length} registros se sincronizaran al reconectar.`
          : `Se cargaron ${newRows.length} armas. Omitidas por duplicado: ${imported.length - newRows.length}.`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo importar el archivo."
      toast({ title: "Error de importación", description: message, variant: "destructive" })
    } finally {
      setIsImporting(false)
      event.target.value = ""
    }
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
              <SelectItem value="Robada">Robada</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            <FileSpreadsheet className="w-4 h-4" /> EXCEL
          </Button>
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleImportExcel}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => excelInputRef.current?.click()}
            className="border-white/20 text-white hover:bg-white/10 h-10 gap-2"
            disabled={isImporting}
          >
            {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            IMPORTAR
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
                        <SelectItem value="Robada">Robada</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {formData.status === 'Asignada' && (
                  <>
                    <div className="grid gap-2">
                      <Label className="text-[10px] uppercase font-black text-primary">Asignada a (Nombre)</Label>
                      <Input value={formData.assignedTo} onChange={e => setFormData({...formData, assignedTo: e.target.value})} className="bg-white/5 border-white/10 h-11" />
                    </div>
                    <div className="grid gap-2">
                      <Label className="text-[10px] uppercase font-black text-primary">Municiones</Label>
                      <Input
                        type="number"
                        min={0}
                        value={formData.ammoCount}
                        onChange={e => setFormData({...formData, ammoCount: Number(e.target.value)})}
                        className="bg-white/5 border-white/10 h-11"
                        placeholder="Cantidad de municiones"
                      />
                    </div>
                  </>
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

          <div className="pt-1 space-y-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" />
                <Label className="text-[10px] font-black uppercase text-primary">Agrupado por tipo</Label>
              </div>
              <div className="space-y-1.5">
                {groupedByType.slice(0, 5).map((group) => (
                  <div key={`type-${group.name}`} className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2.5 py-1.5">
                    <span className="text-[10px] font-bold text-white/80 uppercase truncate">{group.name}</span>
                    <span className="text-[10px] font-black text-primary">{group.count}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-[10px] font-black uppercase text-primary">Agrupado por estado</Label>
              <div className="space-y-1.5">
                {groupedByStatus.slice(0, 5).map((group) => (
                  <div key={`status-${group.name}`} className="flex items-center justify-between rounded border border-white/10 bg-black/30 px-2.5 py-1.5">
                    <span className="text-[10px] font-bold text-white/80 uppercase truncate">{group.name}</span>
                    <span className="text-[10px] font-black text-primary">{group.count}</span>
                  </div>
                ))}
              </div>
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
                      <TableCell className="px-4">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-[80px] bg-white/5 border-white/10 text-[10px] font-bold"
                          defaultValue={weapon.ammoCount ?? 0}
                          placeholder="Municiones"
                          onBlur={(e) => {
                            const v = Number(e.target.value)
                            if (v !== (weapon.ammoCount ?? 0)) handleUpdateWeapon(weapon.id, { ammoCount: v })
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
                          <SelectItem value="Robada">Robada</SelectItem>
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
