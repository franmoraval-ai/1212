"use client"

import { useMemo, useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  Plus, 
  Trash2, 
  Loader2,
  Camera,
  MapPin,
  ClipboardCheck,
  ListChecks,
  ShieldAlert,
  AlertCircle,
  X,
  FileSpreadsheet,
  FileDown
} from "lucide-react"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { TacticalMap } from "@/components/ui/tactical-map"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import Image from "next/image"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { buildEvidenceBundle, evaluateGeoRisk } from "@/lib/field-intel"

export default function SupervisionPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("list")
  const [isLocating, setIsLocating] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const [formData, setFormData] = useState({
    operationName: "",
    officerName: "",
    type: "Oficial de Seguridad" as "Oficial de Seguridad" | "Propiedad",
    idNumber: "",
    officerPhone: "",
    weaponModel: "",
    weaponSerial: "",
    reviewPost: "",
    lugar: "",
    gps: null as { lat: number, lng: number, accuracy?: number } | null,
    checklist: {
      uniform: true,
      equipment: true,
      punctuality: true,
      service: true
    },
    checklistReasons: {
      uniform: "",
      equipment: "",
      punctuality: "",
      service: ""
    },
    propertyDetails: {
      luz: "",
      perimetro: "",
      sacate: "",
      danosPropiedad: ""
    },
    observations: ""
  })

  const { data: reportesData, isLoading: loading } = useCollection(user ? "supervisions" : null, { orderBy: "created_at", orderDesc: true })
  const { data: operationCatalog } = useCollection<{ operationName?: string; clientName?: string; isActive?: boolean }>(
    user ? "operation_catalog" : null,
    { orderBy: "operation_name", orderDesc: false }
  )

  const activeCatalog = useMemo(
    () =>
      (operationCatalog ?? []).filter((item) => item.isActive !== false).map((item) => ({
        operationName: String(item.operationName ?? "").trim(),
        clientName: String(item.clientName ?? "").trim(),
      })),
    [operationCatalog]
  )

  const operationOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((item) => item.operationName))).filter(Boolean),
    [activeCatalog]
  )

  const clientOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((item) => item.clientName))).filter(Boolean),
    [activeCatalog]
  )

  const visibleReports = useMemo(() => {
    const all = reportesData ?? []
    const roleLevel = Number(user?.roleLevel ?? 1)

    if (roleLevel >= 3) {
      return all
    }

    if (roleLevel === 2) {
      const uid = user?.uid ?? ""
      const email = String(user?.email ?? "").toLowerCase()
      return all.filter((r) => {
        const supervisorValue = String(r.supervisorId ?? "")
        return supervisorValue === uid || supervisorValue.toLowerCase() === email
      })
    }

    return []
  }, [reportesData, user])

  const officerDirectory = useMemo(() => {
    const byName = new Map<string, { idNumber: string; officerPhone: string }>()

    ;(reportesData ?? []).forEach((row) => {
      const name = String(row.officerName ?? "").trim()
      if (!name) return

      const current = byName.get(name) ?? { idNumber: "", officerPhone: "" }
      const nextId = current.idNumber || String(row.idNumber ?? "").trim()
      const nextPhone = current.officerPhone || String(row.officerPhone ?? "").trim()
      byName.set(name, { idNumber: nextId, officerPhone: nextPhone })
    })

    return byName
  }, [reportesData])

  const officerNameOptions = useMemo(
    () => Array.from(officerDirectory.keys()).sort((a, b) => a.localeCompare(b)),
    [officerDirectory]
  )

  const officerIdOptions = useMemo(
    () => Array.from(new Set(Array.from(officerDirectory.values()).map((item) => item.idNumber).filter(Boolean))),
    [officerDirectory]
  )

  const officerPhoneOptions = useMemo(
    () => Array.from(new Set(Array.from(officerDirectory.values()).map((item) => item.officerPhone).filter(Boolean))),
    [officerDirectory]
  )

  const handleOfficerNameChange = (name: string) => {
    const profile = officerDirectory.get(name.trim())
    setFormData((prev) => ({
      ...prev,
      officerName: name,
      idNumber: profile?.idNumber || prev.idNumber,
      officerPhone: profile?.officerPhone || prev.officerPhone,
    }))
  }

  const handleGetGPS = () => {
    setIsLocating(true)
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData({ ...formData, gps: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy } })
          setIsLocating(false)
          toast({ title: "GPS FIJADO", description: "Coordenadas tácticas capturadas con éxito." })
        },
        () => {
          setIsLocating(false)
          toast({ title: "ERROR GPS", description: "No se pudo acceder a la ubicación.", variant: "destructive" })
        }
      )
    }
  }

  const photoInputRef = useRef<HTMLInputElement>(null)
  const handlePhotoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file?.type.startsWith("image/")) return
    const reader = new FileReader()
    reader.onload = () => setPhotos((prev) => [...prev, reader.result as string])
    reader.readAsDataURL(file)
    e.target.value = ""
  }
  const addPhoto = () => photoInputRef.current?.click()

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index))
  }

  const handleAddReport = async () => {
    if (!user) return

    if (formData.type === "Oficial de Seguridad") {
      const issues = Object.keys(formData.checklist).filter(key => 
        !formData.checklist[key as keyof typeof formData.checklist] && 
        !formData.checklistReasons[key as keyof typeof formData.checklistReasons]
      )
      if (issues.length > 0) {
        toast({ title: "CAMPOS REQUERIDOS", description: "Justifique los estándares no cumplidos.", variant: "destructive" })
        return
      }
    }
    
    const row = toSnakeCaseKeys({
      operationName: formData.operationName,
      officerName: formData.officerName,
      type: formData.type,
      idNumber: formData.idNumber,
      officerPhone: formData.officerPhone,
      weaponModel: formData.weaponModel,
      weaponSerial: formData.weaponSerial,
      reviewPost: formData.reviewPost,
      lugar: formData.lugar || undefined,
      propertyDetails: formData.type === "Propiedad" ? formData.propertyDetails : undefined,
      photos,
      // Compatibilidad: a partir de ahora guardamos email para visualizacion legible.
      supervisorId: user.email ?? user.uid,
      createdAt: nowIso(),
      status: formData.type === "Propiedad" ? "REVISIÓN PROPIEDAD" : (Object.values(formData.checklist).every(v => v) ? "CUMPLIM" : "CON NOVEDAD"),
      checklist: formData.checklist,
      checklistReasons: formData.checklistReasons,
      observations: formData.observations,
      gps: formData.gps,
      evidenceBundle: buildEvidenceBundle({
        checkpointId: formData.reviewPost || "supervision",
        gps: formData.gps ? { ...formData.gps, capturedAt: nowIso() } : null,
        photos,
        user,
      }),
      geoRisk: evaluateGeoRisk(formData.gps ? { ...formData.gps, capturedAt: nowIso() } : null),
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, { table: "supervisions", action: "insert", payload: row })
    if (!result.ok) {
      const rawMessage = String(result.error || "")
      const missingOfficerPhone = rawMessage.toLowerCase().includes("officer_phone")

      if (!missingOfficerPhone) {
        toast({ title: "Error", description: error.message, variant: "destructive" })
        return
      }

      const fallbackRow = { ...row }
      delete (fallbackRow as Record<string, unknown>).officer_phone
      const fallbackResult = await runMutationWithOffline(supabase, { table: "supervisions", action: "insert", payload: fallbackRow })
      if (!fallbackResult.ok) {
        toast({ title: "Error", description: fallbackResult.error, variant: "destructive" })
        return
      }

      toast({
        title: "Registro guardado sin teléfono",
        description: "Falta columna officer_phone en base de datos. Ejecute supabase/fix_officer_phone_schema_cache.sql.",
        variant: "destructive",
      })
      setActiveTab("list")
      setPhotos([])
      setFormData({
        operationName: "",
        officerName: "",
        type: "Oficial de Seguridad",
        idNumber: "",
        officerPhone: "",
        weaponModel: "",
        weaponSerial: "",
        reviewPost: "",
        lugar: "",
        gps: null,
        checklist: { uniform: true, equipment: true, punctuality: true, service: true },
        checklistReasons: { uniform: "", equipment: "", punctuality: "", service: "" },
        propertyDetails: { luz: "", perimetro: "", sacate: "", danosPropiedad: "" },
        observations: "",
      })
      return
    }
    toast({
      title: result.queued ? "Registro en cola" : "REGISTRO GUARDADO",
      description: result.queued
        ? "Sin senal: se sincronizara automaticamente al reconectar."
        : "Fiscalización almacenada exitosamente.",
    })
    setActiveTab("list")
    setPhotos([])
    setFormData({ 
      operationName: "",
      officerName: "", 
      type: "Oficial de Seguridad", 
      idNumber: "",
      officerPhone: "",
      weaponModel: "",
      weaponSerial: "",
      reviewPost: "",
      lugar: "",
      gps: null, 
      checklist: { uniform: true, equipment: true, punctuality: true, service: true }, 
      checklistReasons: { uniform: "", equipment: "", punctuality: "", service: "" },
      propertyDetails: { luz: "", perimetro: "", sacate: "", danosPropiedad: "" },
      observations: "" 
    })
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const result = await runMutationWithOffline(supabase, { table: "supervisions", action: "delete", match: { id } })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Eliminacion en cola" : "Eliminado",
        description: result.queued ? "Se eliminara al reconectar." : "El registro de supervisión se eliminó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportExcel = async () => {
    const rows = visibleReports.map((r) => ({
      fecha: (r.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
      operacion: r.operationName || "—",
      oficial: r.officerName || "—",
      cedula: r.idNumber || "—",
      telefono: r.officerPhone || "—",
      puesto: r.reviewPost || "—",
      arma: r.weaponModel || "—",
      estado: r.status || "—",
    }))
    const result = await exportToExcel(rows, "Supervisión", [
      { header: "FECHA", key: "fecha", width: 12 },
      { header: "OPERACIÓN", key: "operacion", width: 20 },
      { header: "OFICIAL", key: "oficial", width: 20 },
      { header: "CEDULA", key: "cedula", width: 14 },
      { header: "TELEFONO", key: "telefono", width: 14 },
      { header: "PUESTO", key: "puesto", width: 20 },
      { header: "ARMA", key: "arma", width: 15 },
      { header: "ESTADO", key: "estado", width: 12 },
    ], "HO_SUPERVISION")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = visibleReports.map((r) => [
      (r.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
      String(r.operationName || "—").slice(0, 18),
      String(r.officerName || "—").slice(0, 15),
      String(r.idNumber || "—").slice(0, 14),
      String(r.officerPhone || "—").slice(0, 14),
      String(r.reviewPost || "—").slice(0, 15),
      String(r.weaponModel || "—").slice(0, 12),
      String(r.status || "—"),
    ])
    const result = exportToPdf("SUPERVISIÓN CAMPO", ["FECHA", "OPERACIÓN", "OFICIAL", "CEDULA", "TELEFONO", "PUESTO", "ARMA", "ESTADO"], rows, "HO_SUPERVISION")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar registro de supervisión?"
        description="Se borrará este registro. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic flex items-center gap-3">
                    <Select
                      value={formData.operationName}
                      onValueChange={(value) => {
                        const matched = activeCatalog.find((item) => item.operationName === value)
                        setFormData({
                          ...formData,
                          operationName: value,
                          reviewPost: matched?.clientName || formData.reviewPost,
                        })
                      }}
                    >
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar operación" /></SelectTrigger>
                      <SelectContent>
                        {operationOptions.map((op) => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {operationOptions.length === 0 && (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Sin operaciones activas en catálogo.</p>
                    )}
              Control de Supervisión
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
              <FileSpreadsheet className="w-4 h-4" /> EXCEL
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
              <FileDown className="w-4 h-4" /> PDF
            </Button>
            <TabsList className="bg-white/5 border border-white/5 h-12">
              <TabsTrigger value="list" className="text-[10px] uppercase font-black px-8">Historial</TabsTrigger>
              <TabsTrigger value="new" className="text-[10px] uppercase font-black px-8">Nueva Fiscalización</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="list">
          <Card className="bg-[#0c0c0c] border-white/5 shadow-xl overflow-hidden">
            <CardHeader className="border-b border-white/5 px-6">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Registros Tácticos de Campo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-white/[0.02] border-b border-white/5">
                    <tr>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Fecha</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Oficial / Puesto</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Arma</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest text-center">Estatus</th>
                      <th className="px-6 py-4 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {loading ? (
                      <tr><td colSpan={5} className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></td></tr>
                    ) : visibleReports.length > 0 ? (
                      visibleReports.map((report) => (
                        <tr key={report.id} className="hover:bg-white/[0.01] transition-colors border-b border-white/5">
                          <td className="px-6 py-4 text-[10px] text-white/50 font-mono">
                            {(report.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() ?? "---"}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black text-white uppercase italic">{String(report.officerName)}</span>
                              <span className="text-[9px] text-muted-foreground font-bold uppercase">{String(report.reviewPost)}</span>
                              <span className="text-[9px] text-white/50 font-bold uppercase">CED: {String(report.idNumber || "—")} | TEL: {String(report.officerPhone || "—")}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-[10px] font-bold text-white/70">
                            {String(report.weaponModel || "N/A")}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[8px] font-black uppercase ${
                              report.status === 'CON NOVEDAD' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                            }`}>
                              {String(report.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <Button onClick={() => setDeleteId(report.id)} size="icon" variant="ghost" className="h-8 w-8 text-white/20 hover:text-destructive">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={5} className="py-20 text-center text-[10px] font-black uppercase text-muted-foreground/30 italic">Sin registros tácticos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" className="space-y-6">
          <input ref={photoInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoFile} />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <Card className="bg-[#111111] border-white/5 tactical-card">
                    <Select value={formData.reviewPost} onValueChange={(value) => setFormData({...formData, reviewPost: value})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar cliente/puesto" /></SelectTrigger>
                      <SelectContent>
                        {clientOptions.map((client) => (
                          <SelectItem key={client} value={client}>{client}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Operación / Cliente</Label>
                    <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.operationName} onChange={e => setFormData({...formData, operationName: e.target.value})} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Tipo de Fiscalización</Label>
                    <Select onValueChange={v => setFormData({...formData, type: v as "Oficial de Seguridad" | "Propiedad"})} value={formData.type}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Oficial de Seguridad">Oficial de Seguridad</SelectItem><SelectItem value="Propiedad">Propiedad</SelectItem></SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Identificación, Lugar y Armamento</CardTitle></CardHeader>
                <CardContent className="space-y-5 pt-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Nombre del Oficial</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" list="officer-name-list" value={formData.officerName} onChange={e => handleOfficerNameChange(e.target.value)} placeholder="Oficial a cargo" />
                      <datalist id="officer-name-list">
                        {officerNameOptions.map((name) => (
                          <option key={name} value={name} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Puesto de Revisión</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.reviewPost} onChange={e => setFormData({...formData, reviewPost: e.target.value})} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Cédula / ID</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" list="officer-id-list" value={formData.idNumber} onChange={e => setFormData({...formData, idNumber: e.target.value})} placeholder="Ej: 1-1111-1111" />
                      <datalist id="officer-id-list">
                        {officerIdOptions.map((idValue) => (
                          <option key={idValue} value={idValue} />
                        ))}
                      </datalist>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Teléfono</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" list="officer-phone-list" value={formData.officerPhone} onChange={e => setFormData({...formData, officerPhone: e.target.value})} placeholder="Ej: 8888-8888" />
                      <datalist id="officer-phone-list">
                        {officerPhoneOptions.map((phoneValue) => (
                          <option key={phoneValue} value={phoneValue} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Lugar (dirección o punto de revisión)</Label>
                    <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.lugar} onChange={e => setFormData({...formData, lugar: e.target.value})} placeholder="Ej: Edificio A, Entrada principal" />
                  </div>
                  <div className="grid grid-cols-2 gap-4 pt-2 border-t border-white/5">
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase text-primary">Modelo de Arma</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.weaponModel} onChange={e => setFormData({...formData, weaponModel: e.target.value})} />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase text-primary">Matrícula / Serie</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.weaponSerial} onChange={e => setFormData({...formData, weaponSerial: e.target.value})} />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#111111] border-white/5 tactical-card overflow-hidden h-full min-h-[400px]">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">GPX – Ubicación (hora se registra al guardar)</CardTitle></CardHeader>
              <CardContent className="p-0 h-[calc(100%-60px)] relative">
                {formData.gps ? (
                  <TacticalMap center={[formData.gps.lng, formData.gps.lat]} zoom={16} markers={[{ lng: formData.gps.lng, lat: formData.gps.lat, color: '#F59E0B' }]} className="w-full h-full" />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                    <Button onClick={handleGetGPS} disabled={isLocating} variant="outline" className="border-white/10 text-white font-black uppercase text-[10px] h-11 px-8">
                      {isLocating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
                      Capturar Coordenadas GPS
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {formData.type === "Propiedad" ? (
            <Card className="bg-[#111111] border-white/5 tactical-card lg:col-span-2">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Revisión de Propiedad</CardTitle></CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">¿Cómo está la luz?</Label>
                    <Select value={formData.propertyDetails.luz} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, luz: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bien">Bien (encendida, sin fallas)</SelectItem>
                        <SelectItem value="Mal">Mal (intermitente o fallando)</SelectItem>
                        <SelectItem value="Apagada">Apagada / sin luz</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Estado del perímetro</Label>
                    <Select value={formData.propertyDetails.perimetro} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, perimetro: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Correcto">Correcto (cerrado, sin daños)</SelectItem>
                        <SelectItem value="Dañado">Dañado o abierto</SelectItem>
                        <SelectItem value="No aplica">No aplica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Estado del césped / sacate</Label>
                    <Select value={formData.propertyDetails.sacate} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, sacate: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cortado">Cortado (en orden)</SelectItem>
                        <SelectItem value="Alto">Alto o descuidado</SelectItem>
                        <SelectItem value="Regular">Regular</SelectItem>
                        <SelectItem value="No aplica">No aplica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Daños a la propiedad (descripción)</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[80px] uppercase text-xs" value={formData.propertyDetails.danosPropiedad} onChange={e => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, danosPropiedad: e.target.value }})} placeholder="Describa daños observados, si los hay..." />
                  </div>
                </div>
                <div className="pt-4 border-t border-white/5 space-y-6">
                  <div className="space-y-4">
                    <Label className="text-[10px] font-black uppercase opacity-60">Evidencia Fotográfica (lugar, GPX y hora se registran automáticamente)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                      {photos.map((photo, i) => (
                        <div key={i} className="relative aspect-square rounded overflow-hidden border border-white/10 group">
                          <Image src={photo} alt="Evidencia" fill unoptimized sizes="(max-width: 640px) 50vw, 16vw" className="object-cover" />
                          <button type="button" onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3 text-white" /></button>
                        </div>
                      ))}
                      <Button type="button" onClick={addPhoto} variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60"><Camera className="w-5 h-5 text-white/40" /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase opacity-60">Observaciones Generales</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[100px] uppercase text-xs" value={formData.observations} onChange={e => setFormData({...formData, observations: e.target.value})} />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 pt-4">
                    <Button variant="ghost" onClick={() => setActiveTab("list")} className="flex-1 h-14 font-black uppercase text-[10px]">Cancelar</Button>
                    <Button onClick={handleAddReport} className="flex-[2] h-14 bg-primary text-black font-black uppercase tracking-widest text-[11px]">Guardar Fiscalización de Campo</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-[#111111] border-white/5 tactical-card lg:col-span-2">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Auditoría de Estándares</CardTitle></CardHeader>
              <CardContent className="space-y-8 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {[
                    { id: 'uniform', label: 'Uniforme Táctico Completo' },
                    { id: 'equipment', label: 'Equipo de Trabajo Reglamentario' },
                    { id: 'punctuality', label: 'Puntualidad en Puesto' },
                    { id: 'service', label: 'Actitud y Servicio' }
                  ].map((item) => (
                    <div key={item.id} className="space-y-3 p-4 bg-black/30 rounded border border-white/5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] font-black uppercase text-white">{item.label}</Label>
                        <Checkbox checked={formData.checklist[item.id as keyof typeof formData.checklist]} onCheckedChange={(v) => setFormData({...formData, checklist: { ...formData.checklist, [item.id]: !!v }})} className="data-[state=checked]:bg-primary" />
                      </div>
                      {!formData.checklist[item.id as keyof typeof formData.checklist] && (
                        <div className="space-y-1.5 animate-in slide-in-from-top-2 duration-200">
                          <Label className="text-[8px] font-black uppercase text-red-500 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Justificación Obligatoria</Label>
                          <Textarea className="bg-[#0c0c0c] border-red-500/30 text-[10px] uppercase h-16" value={formData.checklistReasons[item.id as keyof typeof formData.checklistReasons]} onChange={e => setFormData({...formData, checklistReasons: { ...formData.checklistReasons, [item.id]: e.target.value }})} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/5 space-y-6">
                  <div className="space-y-4">
                    <Label className="text-[10px] font-black uppercase opacity-60">Evidencia Fotográfica (Múltiple)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                      {photos.map((photo, i) => (
                        <div key={i} className="relative aspect-square rounded overflow-hidden border border-white/10 group">
                          <Image src={photo} alt="Evidencia" fill unoptimized sizes="(max-width: 640px) 50vw, 16vw" className="object-cover" />
                          <button onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3 text-white" /></button>
                        </div>
                      ))}
                      <Button onClick={addPhoto} variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60"><Camera className="w-5 h-5 text-white/40" /></Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase opacity-60">Observaciones Generales</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[100px] uppercase text-xs" value={formData.observations} onChange={e => setFormData({...formData, observations: e.target.value})} />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-4">
                  <Button variant="ghost" onClick={() => setActiveTab("list")} className="flex-1 h-14 font-black uppercase text-[10px]">Cancelar</Button>
                  <Button onClick={handleAddReport} className="flex-[2] h-14 bg-primary text-black font-black uppercase tracking-widest text-[11px]">Guardar Fiscalización de Campo</Button>
                </div>
              </CardContent>
            </Card>
          )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}