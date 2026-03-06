"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  Briefcase, 
  Trash2, 
  Loader2,
  FileText,
  TrendingUp,
  MessageSquare,
  MapPin,
  Shield,
  User,
  ClipboardCheck,
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
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"

const emptyOfficerEval = { uniform: true, attitude: true, knowledge: true, punctuality: true }
const emptyPostEval = { condition: true, equipment: true, protocols: true }

export default function AccountAuditPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("list")
  const [loadingForm, setLoadingForm] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  
  const [formData, setFormData] = useState({
    operationName: "",
    officerName: "",
    officerId: "",
    officerPhone: "",
    postName: "",
    officerEvaluation: { ...emptyOfficerEval },
    postEvaluation: { ...emptyPostEval },
    administrativeCompliance: {
      billingCorrect: true,
      rosterUpdated: true,
      documentationInPlace: true
    },
    findings: "",
    actionPlan: ""
  })

  const { data: auditsData, isLoading: loadingAudits } = useCollection(user ? "management_audits" : null, { orderBy: "created_at", orderDesc: true })
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

  const officerDirectory = useMemo(() => {
    const byName = new Map<string, { officerId: string; officerPhone: string }>()

    ;(auditsData ?? []).forEach((row) => {
      const name = String(row.officerName ?? "").trim()
      if (!name) return

      const current = byName.get(name) ?? { officerId: "", officerPhone: "" }
      const nextId = current.officerId || String(row.officerId ?? "").trim()
      const nextPhone = current.officerPhone || String(row.officerPhone ?? "").trim()
      byName.set(name, { officerId: nextId, officerPhone: nextPhone })
    })

    return byName
  }, [auditsData])

  const officerNameOptions = useMemo(
    () => Array.from(officerDirectory.keys()).sort((a, b) => a.localeCompare(b)),
    [officerDirectory]
  )

  const officerIdOptions = useMemo(
    () => Array.from(new Set(Array.from(officerDirectory.values()).map((item) => item.officerId).filter(Boolean))),
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
      officerId: profile?.officerId || prev.officerId,
      officerPhone: profile?.officerPhone || prev.officerPhone,
    }))
  }

  const handleAddAudit = async () => {
    if (!user) return
    if (!formData.operationName) {
      toast({ title: "CAMPOS OBLIGATORIOS", description: "Indique la operación.", variant: "destructive" })
      return
    }
    if (!formData.officerName || !formData.postName) {
      toast({ title: "CAMPOS OBLIGATORIOS", description: "Complete el oficial auditado y el puesto.", variant: "destructive" })
      return
    }

    setLoadingForm(true)
    const row = toSnakeCaseKeys({ ...formData, managerId: user.uid, createdAt: nowIso() }) as Record<string, unknown>
    const { error } = await supabase.from("management_audits").insert(row)
    setLoadingForm(false)
    if (error) {
      const rawMessage = String(error.message || "")
      const missingOfficerPhone = rawMessage.toLowerCase().includes("officer_phone")

      if (!missingOfficerPhone) {
        toast({ title: "Error", description: error.message, variant: "destructive" })
        return
      }

      const fallbackRow = { ...row }
      delete (fallbackRow as Record<string, unknown>).officer_phone
      const { error: fallbackError } = await supabase.from("management_audits").insert(fallbackRow)
      if (fallbackError) {
        toast({ title: "Error", description: fallbackError.message, variant: "destructive" })
        return
      }

      toast({
        title: "Auditoría guardada sin teléfono",
        description: "Falta columna officer_phone en base de datos. Ejecute supabase/fix_officer_phone_schema_cache.sql.",
        variant: "destructive",
      })
      setActiveTab("list")
      setFormData({
        operationName: "",
        officerName: "",
        officerId: "",
        officerPhone: "",
        postName: "",
        officerEvaluation: { ...emptyOfficerEval },
        postEvaluation: { ...emptyPostEval },
        administrativeCompliance: { billingCorrect: true, rosterUpdated: true, documentationInPlace: true },
        findings: "",
        actionPlan: "",
      })
      return
    }
    toast({ title: "AUDITORÍA GUARDADA", description: "Auditoría gerencial registrada exitosamente." })
    setActiveTab("list")
    setFormData({ 
      operationName: "",
      officerName: "",
      officerId: "",
      officerPhone: "",
      postName: "",
      officerEvaluation: { ...emptyOfficerEval },
      postEvaluation: { ...emptyPostEval },
      administrativeCompliance: { billingCorrect: true, rosterUpdated: true, documentationInPlace: true },
      findings: "",
      actionPlan: ""
    })
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const { error } = await supabase.from("management_audits").delete().eq("id", id)
      if (error) throw error
      toast({ title: "Eliminado", description: "La auditoría se eliminó correctamente." })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const getAuditStatus = (audit: { officerEvaluation?: Record<string, boolean>; postEvaluation?: Record<string, boolean> }) => {
    const officer = audit.officerEvaluation ? Object.values(audit.officerEvaluation).every(Boolean) : true
    const post = audit.postEvaluation ? Object.values(audit.postEvaluation).every(Boolean) : true
    return officer && post ? "CUMPLIMIENTO" : "CON OBSERVACIONES"
  }

  const handleExportExcel = async () => {
    const rows = (auditsData || []).map((a) => ({
      operacion: a.operationName || "—",
      oficial: a.officerName || "—",
      cedula: a.officerId || "—",
      telefono: a.officerPhone || "—",
      puesto: a.postName || "—",
      estado: getAuditStatus(a as { officerEvaluation?: Record<string, boolean>; postEvaluation?: Record<string, boolean> }),
      fecha: (a.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
    }))
    const result = await exportToExcel(
      rows,
      "Auditoría Gerencial",
      [
        { header: "OPERACIÓN", key: "operacion", width: 25 },
        { header: "OFICIAL", key: "oficial", width: 20 },
        { header: "CEDULA", key: "cedula", width: 14 },
        { header: "TELEFONO", key: "telefono", width: 14 },
        { header: "PUESTO", key: "puesto", width: 20 },
        { header: "ESTADO", key: "estado", width: 15 },
        { header: "FECHA", key: "fecha", width: 12 },
      ],
      "HO_AUDITORIA_GERENCIAL"
    )
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = (auditsData || []).map((a) => [
      String(a.operationName ?? "—").slice(0, 25),
      String(a.officerName ?? "—").slice(0, 18),
      String(a.officerId ?? "—").slice(0, 14),
      String(a.officerPhone ?? "—").slice(0, 14),
      String(a.postName ?? "—").slice(0, 18),
      getAuditStatus(a as { officerEvaluation?: Record<string, boolean>; postEvaluation?: Record<string, boolean> }),
      (a.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString?.() || "—",
    ])
    const result = exportToPdf(
      "AUDITORÍA GERENCIAL",
      ["OPERACIÓN", "OFICIAL", "CEDULA", "TELEFONO", "PUESTO", "ESTADO", "FECHA"],
      rows,
      "HO_AUDITORIA_GERENCIAL"
    )
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-10 animate-in fade-in duration-500">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar auditoría gerencial?"
        description="Se borrará este registro. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-10">
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3 mb-2">
              <div className="bg-secondary p-2 rounded">
                <Briefcase className="w-6 h-6 text-white" />
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white uppercase italic tracking-tighter">
                AUDITORÍA GERENCIAL
              </h1>
            </div>
            <p className="text-muted-foreground text-[10px] font-black uppercase tracking-[0.3em] opacity-40">
              GERENTE DE CUENTA — OFICIAL, PUESTO Y OPERACIÓN
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2 text-[10px]">
              <FileSpreadsheet className="w-3 h-3" /> EXCEL
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2 text-[10px]">
              <FileDown className="w-3 h-3" /> PDF
            </Button>
            <TabsList className="bg-white/5 p-1 rounded-md border border-white/5 h-12">
              <TabsTrigger value="list" className="text-[10px] font-black uppercase px-6 h-10">HISTORIAL</TabsTrigger>
              <TabsTrigger value="new" className="text-[10px] font-black uppercase px-6 h-10">NUEVA AUDITORÍA</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="list" className="mt-0">
          <div className="grid grid-cols-1 gap-6">
            {loadingAudits ? (
              <div className="h-64 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : auditsData && auditsData.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {auditsData.map((audit) => (
                  <Card key={audit.id} className="bg-[#111111] border-white/5 hover:border-primary/30 transition-all group overflow-hidden relative">
                    <div className="absolute top-0 right-0 p-4">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${getAuditStatus(audit as { officerEvaluation?: Record<string, boolean>; postEvaluation?: Record<string, boolean> }) === "CUMPLIMIENTO" ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {getAuditStatus(audit as { officerEvaluation?: Record<string, boolean>; postEvaluation?: Record<string, boolean> })}
                      </span>
                    </div>
                    <CardHeader>
                      <CardTitle className="text-sm font-black text-white uppercase italic group-hover:text-primary transition-colors pr-24">
                        {String(audit.operationName ?? "")}
                      </CardTitle>
                      <div className="flex flex-col gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                        {audit.officerName != null && <span className="flex items-center gap-2"><User className="w-3 h-3" /> {String(audit.officerName)}</span>}
                        <span className="text-[9px] text-white/50 uppercase">CED: {String(audit.officerId ?? "—")} | TEL: {String(audit.officerPhone ?? "—")}</span>
                        {audit.postName != null && <span className="flex items-center gap-2"><MapPin className="w-3 h-3" /> {String(audit.postName)}</span>}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {(audit.officerEvaluation != null || audit.postEvaluation != null) && (
                        <div className="bg-black/40 p-3 rounded border border-white/5 space-y-2">
                          {audit.officerEvaluation != null && (
                            <div>
                              <p className="text-[9px] font-black text-muted-foreground uppercase mb-1">Oficial</p>
                              <div className="grid grid-cols-4 gap-1">
                                {["uniform", "attitude", "knowledge", "punctuality"].map((k) => (
                                  <div key={k} className={`h-1.5 rounded-full ${(audit.officerEvaluation as Record<string, boolean>)?.[k] ? "bg-green-500" : "bg-red-500/40"}`} title={k} />
                                ))}
                              </div>
                            </div>
                          )}
                          {audit.postEvaluation != null && (
                            <div>
                              <p className="text-[9px] font-black text-muted-foreground uppercase mb-1">Puesto</p>
                              <div className="grid grid-cols-3 gap-1">
                                {["condition", "equipment", "protocols"].map((k) => (
                                  <div key={k} className={`h-1.5 rounded-full ${(audit.postEvaluation as Record<string, boolean>)?.[k] ? "bg-green-500" : "bg-red-500/40"}`} title={k} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {audit.administrativeCompliance != null && (
                        <div className="bg-black/40 p-3 rounded border border-white/5">
                          <p className="text-[10px] font-black text-muted-foreground uppercase mb-2">Estado Administrativo</p>
                          <div className="grid grid-cols-3 gap-2">
                            <div className={`h-1.5 rounded-full ${(audit.administrativeCompliance as { billingCorrect?: boolean }).billingCorrect ? "bg-green-500" : "bg-red-500/20"}`} title="Facturación" />
                            <div className={`h-1.5 rounded-full ${(audit.administrativeCompliance as { rosterUpdated?: boolean }).rosterUpdated ? "bg-green-500" : "bg-red-500/20"}`} title="Rosters" />
                            <div className={`h-1.5 rounded-full ${(audit.administrativeCompliance as { documentationInPlace?: boolean }).documentationInPlace ? "bg-green-500" : "bg-red-500/20"}`} title="Docs" />
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="text-[9px] font-mono text-white/30">
                          {(audit.createdAt as { toDate?: () => Date } | undefined)?.toDate?.()?.toLocaleDateString() || "PENDIENTE"}
                        </span>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(audit.id)} className="h-8 w-8 text-destructive/30 hover:text-destructive hover:bg-destructive/10">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : (
              <Card className="bg-[#0c0c0c] border-white/5 border-dashed h-64 flex items-center justify-center">
                <div className="text-center space-y-2">
                  <FileText className="w-10 h-10 text-white/10 mx-auto" />
                  <p className="text-[10px] font-black text-white/20 uppercase tracking-widest italic">No hay auditorías gerenciales</p>
                </div>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="new" className="mt-0">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-4 space-y-6">
              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest">Operación</CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Nombre de la Operación</Label>
                    <Select
                      value={formData.operationName}
                      onValueChange={(value) => {
                        const matched = activeCatalog.find((item) => item.operationName === value)
                        setFormData({ ...formData, operationName: value, postName: matched?.clientName || formData.postName })
                      }}
                    >
                      <SelectTrigger className="bg-black/50 border-white/10 h-11 text-xs font-bold uppercase"><SelectValue placeholder="Seleccionar operación" /></SelectTrigger>
                      <SelectContent>
                        {operationOptions.map((op) => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {operationOptions.length === 0 && (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Sin operaciones activas en catálogo.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                    <User className="w-3 h-3" /> Oficial Auditado
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Nombre del Oficial</Label>
                    <Input 
                      placeholder="EJ: CARLOS MÉNDEZ" 
                      className="bg-black/50 border-white/10 h-11 text-xs font-bold uppercase"
                      list="audit-officer-name-list"
                      value={formData.officerName}
                      onChange={(e) => handleOfficerNameChange(e.target.value)}
                    />
                    <datalist id="audit-officer-name-list">
                      {officerNameOptions.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Cédula / ID</Label>
                    <Input 
                      placeholder="EJ: 1-2345-6789" 
                      className="bg-black/50 border-white/10 h-11 text-xs font-bold uppercase"
                      list="audit-officer-id-list"
                      value={formData.officerId}
                      onChange={(e) => setFormData({...formData, officerId: e.target.value})}
                    />
                    <datalist id="audit-officer-id-list">
                      {officerIdOptions.map((idValue) => (
                        <option key={idValue} value={idValue} />
                      ))}
                    </datalist>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Teléfono</Label>
                    <Input 
                      placeholder="EJ: 8888-8888" 
                      className="bg-black/50 border-white/10 h-11 text-xs font-bold uppercase"
                      list="audit-officer-phone-list"
                      value={formData.officerPhone}
                      onChange={(e) => setFormData({...formData, officerPhone: e.target.value})}
                    />
                    <datalist id="audit-officer-phone-list">
                      {officerPhoneOptions.map((phoneValue) => (
                        <option key={phoneValue} value={phoneValue} />
                      ))}
                    </datalist>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                    <MapPin className="w-3 h-3" /> Puesto Auditado
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6 space-y-4">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Nombre del Puesto</Label>
                    <Select value={formData.postName} onValueChange={(value) => setFormData({ ...formData, postName: value })}>
                      <SelectTrigger className="bg-black/50 border-white/10 h-11 text-xs font-bold uppercase"><SelectValue placeholder="Seleccionar cliente/puesto" /></SelectTrigger>
                      <SelectContent>
                        {clientOptions.map((client) => (
                          <SelectItem key={client} value={client}>{client}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

            </div>

            <div className="lg:col-span-8 space-y-6">
              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                    <ClipboardCheck className="w-3 h-3" /> Evaluación del Oficial
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {(["uniform", "attitude", "knowledge", "punctuality"] as const).map((key) => (
                      <div key={key} className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                        <Label className="text-[10px] font-black uppercase capitalize">{key === "uniform" ? "Uniforme" : key === "attitude" ? "Actitud" : key === "knowledge" ? "Conocimiento" : "Puntualidad"}</Label>
                        <Checkbox 
                          checked={formData.officerEvaluation[key]} 
                          onCheckedChange={(v) => setFormData({...formData, officerEvaluation: {...formData.officerEvaluation, [key]: !!v}})}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                    <Shield className="w-3 h-3" /> Evaluación del Puesto
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {(["condition", "equipment", "protocols"] as const).map((key) => (
                      <div key={key} className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                        <Label className="text-[10px] font-black uppercase">{key === "condition" ? "Condición del Puesto" : key === "equipment" ? "Equipo Completo" : "Protocolos Cumplidos"}</Label>
                        <Checkbox 
                          checked={formData.postEvaluation[key]} 
                          onCheckedChange={(v) => setFormData({...formData, postEvaluation: {...formData.postEvaluation, [key]: !!v}})}
                        />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest">Cumplimiento Administrativo</CardTitle>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                      <Label className="text-[10px] font-black uppercase">Facturación Correcta</Label>
                      <Checkbox 
                        checked={formData.administrativeCompliance.billingCorrect} 
                        onCheckedChange={(v) => setFormData({...formData, administrativeCompliance: {...formData.administrativeCompliance, billingCorrect: !!v}})}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                      <Label className="text-[10px] font-black uppercase">Rosters al día</Label>
                      <Checkbox 
                        checked={formData.administrativeCompliance.rosterUpdated} 
                        onCheckedChange={(v) => setFormData({...formData, administrativeCompliance: {...formData.administrativeCompliance, rosterUpdated: !!v}})}
                      />
                    </div>
                    <div className="flex items-center justify-between p-4 bg-black/40 rounded border border-white/5">
                      <Label className="text-[10px] font-black uppercase">Documentos Legales</Label>
                      <Checkbox 
                        checked={formData.administrativeCompliance.documentationInPlace} 
                        onCheckedChange={(v) => setFormData({...formData, administrativeCompliance: {...formData.administrativeCompliance, documentationInPlace: !!v}})}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <Card className="bg-[#111111] border-white/5 tactical-card">
                  <CardHeader className="border-b border-white/5">
                    <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                      <TrendingUp className="w-3 h-3" /> Hallazgos Operativos
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <Textarea 
                      placeholder="OBSERVACIONES SOBRE OFICIAL, PUESTO Y OPERACIÓN..." 
                      className="bg-black/40 border-white/10 min-h-[120px] text-xs font-bold uppercase"
                      value={formData.findings}
                      onChange={(e) => setFormData({...formData, findings: e.target.value})}
                    />
                  </CardContent>
                </Card>

                <Card className="bg-[#111111] border-white/5 tactical-card">
                  <CardHeader className="border-b border-white/5">
                    <CardTitle className="text-[10px] font-black text-primary uppercase tracking-widest flex items-center gap-2">
                      <MessageSquare className="w-3 h-3" /> Plan de Acción
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-6">
                    <Textarea 
                      placeholder="COMPROMISOS Y FECHAS DE SEGUIMIENTO..." 
                      className="bg-black/40 border-white/10 min-h-[120px] text-xs font-bold uppercase"
                      value={formData.actionPlan}
                      onChange={(e) => setFormData({...formData, actionPlan: e.target.value})}
                    />
                  </CardContent>
                </Card>
              </div>

              <Button 
                onClick={handleAddAudit} 
                disabled={loadingForm}
                className="w-full h-14 bg-primary text-black font-black uppercase tracking-[0.2em] italic shadow-[0_0_30px_rgba(250,204,21,0.3)]"
              >
                {loadingForm ? (
                  <><Loader2 className="w-5 h-5 animate-spin mr-2" /> PROCESANDO...</>
                ) : (
                  "REGISTRAR AUDITORÍA GERENCIAL"
                )}
              </Button>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
