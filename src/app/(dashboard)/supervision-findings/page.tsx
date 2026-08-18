"use client"

import { useMemo, useState } from "react"
import { AlertTriangle, CheckCircle2, Clock3, FilterX, Loader2, Search, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { type SupervisionFindingRow, useSupervisionFindings } from "@/hooks/use-supervision-findings"

const ALL = "TODOS"

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString()
}

function isOverdue(finding: SupervisionFindingRow) {
  if (finding.status === "CERRADO" || !finding.due_at) return false
  const dueAt = new Date(finding.due_at).getTime()
  return Number.isFinite(dueAt) && dueAt < Date.now()
}

export default function SupervisionFindingsPage() {
  const { toast } = useToast()
  const { findings, isLoading, error, updateFinding } = useSupervisionFindings()
  const [search, setSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [severityFilter, setSeverityFilter] = useState(ALL)
  const [responsibleFilter, setResponsibleFilter] = useState(ALL)
  const [dueFilter, setDueFilter] = useState(ALL)
  const [selectedFinding, setSelectedFinding] = useState<SupervisionFindingRow | null>(null)
  const [nextStatus, setNextStatus] = useState<SupervisionFindingRow["status"]>("ABIERTO")
  const [correctiveAction, setCorrectiveAction] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const responsibleOptions = useMemo(() => Array.from(new Set(
    findings.map((finding) => String(finding.responsible_user_id ?? "").trim()).filter(Boolean)
  )).sort(), [findings])

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return findings.filter((finding) => {
      const responsible = String(finding.responsible_user_id ?? "")
      if (statusFilter !== ALL && finding.status !== statusFilter) return false
      if (severityFilter !== ALL && finding.severity !== severityFilter) return false
      if (responsibleFilter === "SIN_ASIGNAR" && responsible) return false
      if (responsibleFilter !== ALL && responsibleFilter !== "SIN_ASIGNAR" && responsible !== responsibleFilter) return false
      if (dueFilter === "VENCIDOS" && !isOverdue(finding)) return false
      if (dueFilter === "CON_FECHA" && !finding.due_at) return false
      if (dueFilter === "SIN_FECHA" && finding.due_at) return false
      if (!query) return true
      return [
        finding.category,
        finding.description,
        finding.supervision.operation_name,
        finding.supervision.review_post,
        finding.supervision.officer_name,
      ].some((value) => String(value ?? "").toLowerCase().includes(query))
    })
  }, [dueFilter, findings, responsibleFilter, search, severityFilter, statusFilter])

  const openCount = findings.filter((finding) => finding.status !== "CERRADO").length
  const criticalCount = findings.filter((finding) => finding.status !== "CERRADO" && finding.severity === "CRITICA").length
  const overdueCount = findings.filter(isOverdue).length
  const closedCount = findings.filter((finding) => finding.status === "CERRADO").length

  const clearFilters = () => {
    setSearch("")
    setStatusFilter(ALL)
    setSeverityFilter(ALL)
    setResponsibleFilter(ALL)
    setDueFilter(ALL)
  }

  const openUpdate = (finding: SupervisionFindingRow) => {
    setSelectedFinding(finding)
    setNextStatus(finding.status)
    setCorrectiveAction(String(finding.corrective_action ?? ""))
  }

  const saveUpdate = async () => {
    if (!selectedFinding || isSaving) return
    if (nextStatus === "CERRADO" && !correctiveAction.trim()) {
      toast({ title: "Acción correctiva requerida", description: "Describa la corrección antes de cerrar.", variant: "destructive" })
      return
    }
    setIsSaving(true)
    try {
      await updateFinding({ findingId: selectedFinding.id, status: nextStatus, correctiveAction })
      toast({ title: "Hallazgo actualizado", description: "El seguimiento quedó registrado." })
      setSelectedFinding(null)
    } catch (nextError) {
      toast({ title: "No se pudo actualizar", description: nextError instanceof Error ? nextError.message : "Intente nuevamente.", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div>
        <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white">Hallazgos de Supervisión</h1>
        <p className="mt-1 text-xs text-white/55">Seguimiento de incumplimientos detectados en revisiones de campo.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Abiertos", value: openCount, icon: ShieldAlert, color: "text-red-300" },
          { label: "Críticos", value: criticalCount, icon: AlertTriangle, color: "text-amber-300" },
          { label: "Vencidos", value: overdueCount, icon: Clock3, color: "text-orange-300" },
          { label: "Cerrados", value: closedCount, icon: CheckCircle2, color: "text-green-300" },
        ].map((metric) => (
          <Card key={metric.label} className="bg-[#0c0c0c] border-white/5">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div><p className="text-[9px] uppercase font-black text-white/45">{metric.label}</p><p className="text-2xl font-black text-white">{metric.value}</p></div>
              <metric.icon className={`w-5 h-5 ${metric.color}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader><CardTitle className="text-xs font-black uppercase text-white">Filtros</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/35" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Operación, puesto, oficial..." className="pl-9 bg-black/30 border-white/10" />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Todos los estados</SelectItem><SelectItem value="ABIERTO">Abierto</SelectItem><SelectItem value="EN_EJECUCION">En ejecución</SelectItem><SelectItem value="PENDIENTE_VERIFICACION">Pendiente verificación</SelectItem><SelectItem value="CERRADO">Cerrado</SelectItem></SelectContent></Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}><SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Toda severidad</SelectItem><SelectItem value="BAJA">Baja</SelectItem><SelectItem value="MEDIA">Media</SelectItem><SelectItem value="ALTA">Alta</SelectItem><SelectItem value="CRITICA">Crítica</SelectItem></SelectContent></Select>
          <Select value={responsibleFilter} onValueChange={setResponsibleFilter}><SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Todo responsable</SelectItem><SelectItem value="SIN_ASIGNAR">Sin asignar</SelectItem>{responsibleOptions.map((responsible) => <SelectItem key={responsible} value={responsible}>{responsible}</SelectItem>)}</SelectContent></Select>
          <div className="flex gap-2"><Select value={dueFilter} onValueChange={setDueFilter}><SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value={ALL}>Todo vencimiento</SelectItem><SelectItem value="VENCIDOS">Vencidos</SelectItem><SelectItem value="CON_FECHA">Con fecha</SelectItem><SelectItem value="SIN_FECHA">Sin fecha</SelectItem></SelectContent></Select><Button type="button" size="icon" variant="outline" onClick={clearFilters} title="Limpiar filtros" className="shrink-0 border-white/15 text-white"><FilterX className="w-4 h-4" /></Button></div>
        </CardContent>
      </Card>

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader><CardTitle className="text-xs font-black uppercase text-white">Resultados ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="py-16"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div> : error ? <div className="py-12 px-4 text-center text-sm text-red-300">{error.message}</div> : filtered.length === 0 ? <div className="py-12 px-4 text-center text-xs uppercase font-black text-white/35">Sin hallazgos para estos filtros</div> : (
            <div className="divide-y divide-white/5">
              {filtered.map((finding) => (
                <div key={finding.id} className="p-4 grid grid-cols-1 lg:grid-cols-[1.3fr_1fr_auto] gap-3 lg:items-center hover:bg-white/[0.02]">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`px-2 py-0.5 text-[8px] font-black uppercase rounded ${finding.severity === "CRITICA" ? "bg-red-500/20 text-red-200" : finding.severity === "ALTA" ? "bg-orange-500/20 text-orange-200" : "bg-white/10 text-white/70"}`}>{finding.severity}</span><span className="text-[9px] font-black uppercase text-primary">{finding.status.replaceAll("_", " ")}</span>{isOverdue(finding) ? <span className="text-[8px] font-black uppercase text-red-300">Vencido</span> : null}</div><p className="mt-2 text-sm font-black uppercase text-white">{finding.category}</p><p className="mt-1 text-xs text-white/65 line-clamp-2">{finding.description}</p></div>
                  <div className="text-[10px] text-white/60 space-y-1"><p><span className="text-white/35">Operación:</span> {finding.supervision.operation_name || "—"}</p><p><span className="text-white/35">Puesto:</span> {finding.supervision.review_post || "—"}</p><p><span className="text-white/35">Oficial:</span> {finding.supervision.officer_name || "—"}</p><p><span className="text-white/35">Creado:</span> {formatDate(finding.created_at)}</p><p><span className="text-white/35">Vence:</span> {formatDate(finding.due_at)}</p></div>
                  <Button type="button" size="sm" variant="outline" disabled={!finding.canManage} onClick={() => openUpdate(finding)} className="border-white/15 text-white hover:bg-white/10 font-black uppercase text-[9px]">{finding.canManage ? "Gestionar" : "Solo lectura"}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(selectedFinding)} onOpenChange={(open) => !open && setSelectedFinding(null)}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white max-w-lg">
          <DialogHeader><DialogTitle className="text-sm font-black uppercase">Gestionar hallazgo</DialogTitle><DialogDescription className="text-xs text-white/55">Actualice el avance o registre la corrección verificada.</DialogDescription></DialogHeader>
          <div className="space-y-4"><div className="space-y-1"><Label className="text-[9px] uppercase font-black">Estado</Label><Select value={nextStatus} onValueChange={(value) => setNextStatus(value as SupervisionFindingRow["status"])}><SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ABIERTO">Abierto</SelectItem><SelectItem value="EN_EJECUCION">En ejecución</SelectItem><SelectItem value="PENDIENTE_VERIFICACION">Pendiente verificación</SelectItem><SelectItem value="CERRADO">Cerrado</SelectItem></SelectContent></Select></div><div className="space-y-1"><Label className="text-[9px] uppercase font-black">Acción correctiva {nextStatus === "CERRADO" ? "(obligatoria)" : ""}</Label><Textarea value={correctiveAction} onChange={(event) => setCorrectiveAction(event.target.value)} className="min-h-28 bg-black/30 border-white/10" /></div></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => setSelectedFinding(null)} className="border-white/15 text-white">Cancelar</Button><Button type="button" onClick={() => void saveUpdate()} disabled={isSaving} className="bg-primary text-black font-black uppercase">{isSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}Guardar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}