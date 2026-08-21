"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useStationShift } from "@/components/layout/station-shift-provider"
import { useInternalNotesData } from "@/hooks/use-internal-notes-data"
import { useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { nowIso } from "@/lib/supabase-db"
import { fetchInternalApi } from "@/lib/internal-api"
import { BellRing, FileDown } from "lucide-react"

type NoteCategory = "suministros" | "equipo" | "infraestructura" | "otro"
type NotePriority = "baja" | "media" | "alta" | "critica"
type NoteStatus = "abierta" | "en_proceso" | "resuelta"
const INTERNAL_NOTES_SLA_HOURS = Math.max(1, Number(process.env.NEXT_PUBLIC_INTERNAL_NOTES_SLA_HOURS ?? 24))
const UNASSIGNED_USER_VALUE = "__unassigned__"

function toDate(value: unknown) {
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date }
    if (typeof candidate.toDate === "function") {
      const d = candidate.toDate()
      if (!Number.isNaN(d.getTime())) return d
    }
  }
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return null
}

function isNoteOverdue(createdAtValue: unknown, statusValue: unknown) {
  const status = String(statusValue ?? "abierta")
  if (status === "resuelta") return false
  const createdAt = toDate(createdAtValue)
  if (!createdAt) return false
  const elapsedMs = Date.now() - createdAt.getTime()
  return elapsedMs >= INTERNAL_NOTES_SLA_HOURS * 60 * 60 * 1000
}

export default function InternalNotesPage() {
  const { supabase, user } = useSupabase()
  const { user: appUser } = useUser()
  const { enabled: stationModeEnabled, stationLabel, stationPostName, activeOfficerName, openShiftDialog } = useStationShift()
  const { toast } = useToast()
  const isL1 = (appUser?.roleLevel ?? 1) === 1
  const canResolve = (appUser?.roleLevel ?? 1) >= 2
  const actingOfficerName = (stationModeEnabled ? String(activeOfficerName).trim() : "") || String(appUser?.firstName ?? appUser?.email ?? "").trim() || "OPERADOR"

  const [postName, setPostName] = useState("")
  const [category, setCategory] = useState<NoteCategory>("suministros")
  const [priority, setPriority] = useState<NotePriority>("media")
  const [detail, setDetail] = useState("")
  const [isSaving, setIsSaving] = useState(false)
  const [assignmentBusyNoteId, setAssignmentBusyNoteId] = useState("")
  const effectivePostName = stationModeEnabled ? stationPostName : postName
  const { notes: sortedNotes, openCount, overdueCount, assignees, reload } = useInternalNotesData()

  const mutateInternalNote = async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>) => {
    const response = await fetchInternalApi(supabase, "/api/internal-notes", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string
      ok?: boolean
      warning?: string
      delivery?: { sent?: number; targeted?: number; removed?: number } | null
    }
    return {
      ok: response.ok,
      status: response.status,
      error: String(payload.error ?? "No se pudo completar la operación."),
      warning: String(payload.warning ?? ""),
      delivery: payload.delivery ?? null,
    }
  }

  const resetForm = () => {
    setPostName("")
    setCategory("suministros")
    setPriority("media")
    setDetail("")
  }

  const handleCreateNote = async () => {
    if (stationModeEnabled && !activeOfficerName.trim()) {
      openShiftDialog()
      toast({ title: "Turno requerido", description: "Defina el oficial activo antes de registrar una novedad interna.", variant: "destructive" })
      return
    }

    if (!effectivePostName.trim() || !detail.trim()) {
      toast({ title: "Datos incompletos", description: "Puesto y detalle son obligatorios.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    const result = await mutateInternalNote("POST", {
      postName: effectivePostName.trim(),
      category,
      priority,
      detail: detail.trim(),
      status: "abierta",
      reportedByName: actingOfficerName,
      assignedTo: null,
      resolutionNote: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    })
    setIsSaving(false)

    if (!result.ok) {
      toast({ title: "No se pudo guardar", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: "Anotación creada",
      description: "La novedad interna fue registrada.",
    })
    void reload(false)
    resetForm()
  }

  const handleUpdateStatus = async (noteId: string, nextStatus: NoteStatus) => {
    if (!canResolve) {
      toast({ title: "Sin permiso", description: "Solo L2-L4 pueden cambiar estado.", variant: "destructive" })
      return
    }

    const result = await mutateInternalNote("PATCH", {
      id: noteId,
      status: nextStatus,
      resolvedAt: nextStatus === "resuelta" ? nowIso() : null,
      updatedAt: nowIso(),
    })

    if (!result.ok) {
      toast({ title: "No se pudo actualizar", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: "Estado actualizado",
      description: "La anotación fue actualizada.",
    })
    void reload(false)
  }

  const handleAssignNote = async (noteId: string, assignedToUserId: string, notifyAssignee: boolean) => {
    if (!canResolve) {
      toast({ title: "Sin permiso", description: "Solo L2-L4 pueden asignar responsables.", variant: "destructive" })
      return
    }

    const targetUserId = assignedToUserId === UNASSIGNED_USER_VALUE ? "" : assignedToUserId
    const targetAssignee = assignees.find((assignee) => assignee.id === targetUserId)
    const targetName = targetAssignee?.name || "El responsable"
    setAssignmentBusyNoteId(noteId)
    const result = await mutateInternalNote("PATCH", {
      id: noteId,
      assignedToUserId: targetUserId,
      notifyAssignee: Boolean(targetUserId && notifyAssignee),
      updatedAt: nowIso(),
    })
    setAssignmentBusyNoteId("")

    if (!result.ok) {
      toast({ title: "No se pudo asignar", description: result.error, variant: "destructive" })
      return
    }

    if (!targetUserId) {
      toast({ title: "Responsable retirado", description: "La novedad quedó sin responsable asignado." })
    } else if (result.warning) {
      toast({ title: "Responsable asignado", description: result.warning })
    } else if (notifyAssignee && Number(result.delivery?.sent ?? 0) > 0) {
      toast({ title: "Alerta enviada", description: "El responsable recibió la novedad en sus dispositivos activos." })
    } else if (notifyAssignee) {
      toast({
        title: "Responsable asignado",
        description: `${targetName} debe iniciar sesión en su dispositivo y abrir Configuración > Activar notificaciones.`,
      })
    } else {
      toast({ title: "Responsable actualizado", description: "La novedad fue asignada correctamente." })
    }
    void reload(false)
  }

  const handleDeleteResolved = async (noteId: string, status: NoteStatus) => {
    if (!canResolve) {
      toast({ title: "Sin permiso", description: "Solo L2-L4 pueden eliminar anotaciones.", variant: "destructive" })
      return
    }
    if (status !== "resuelta") {
      toast({ title: "Acción no permitida", description: "Solo se puede eliminar cuando esté resuelta.", variant: "destructive" })
      return
    }

    const confirmed = window.confirm("¿Eliminar esta anotación resuelta? Esta acción no se puede deshacer.")
    if (!confirmed) return

    const result = await mutateInternalNote("DELETE", { id: noteId })

    if (!result.ok) {
      toast({ title: "No se pudo eliminar", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: "Anotación eliminada",
      description: "Se eliminó la anotación resuelta.",
    })
    void reload(false)
  }

  const handleExportPdf = async () => {
    if (sortedNotes.length === 0) {
      toast({ title: "Sin novedades", description: "No hay novedades internas disponibles para exportar." })
      return
    }

    const { exportToPdf } = await import("@/lib/export-utils")
    const rows = sortedNotes.map((note) => {
      const status = String(note.status ?? "abierta") as NoteStatus
      const statusLabel = status === "resuelta" ? "Resuelta" : status === "en_proceso" ? "En proceso" : "Abierta"
      return [
        toDate(note.createdAt)?.toLocaleString("es-CR") ?? "Sin fecha",
        String(note.postName ?? "—"),
        String(note.category ?? "otro"),
        String(note.priority ?? "media"),
        isNoteOverdue(note.createdAt, note.status) ? `${statusLabel} / Vencida` : statusLabel,
        String(note.reportedByName ?? note.reportedByEmail ?? "Sin nombre"),
        String(note.assignedTo ?? "Sin asignar"),
        String(note.detail ?? ""),
        String(note.resolutionNote ?? ""),
      ]
    })
    const result = exportToPdf(
      "NOVEDADES INTERNAS DE PUESTOS",
      ["FECHA", "PUESTO", "CATEGORÍA", "PRIORIDAD", "ESTADO", "REPORTÓ", "ATIENDE", "DETALLE", "RESOLUCIÓN"],
      rows,
      "HO_NOVEDADES_INTERNAS"
    )

    if (result.ok) {
      toast({ title: "PDF descargado", description: `${rows.length} novedad(es) incluidas en el archivo.` })
    } else {
      toast({ title: "No se pudo generar", description: result.error, variant: "destructive" })
    }
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Novedades internas de puestos</CardTitle>
          <CardDescription className="text-white/60 text-xs">
            Registro interno de faltantes, suministros y observaciones operativas. Pendientes sin resolver: {openCount} · Vencidas SLA ({INTERNAL_NOTES_SLA_HOURS}h): {overdueCount}
            {isL1 ? " · Vista L1: solo tus novedades." : ""}
          </CardDescription>
          {stationModeEnabled ? (
            <p className="text-[10px] uppercase font-black tracking-wide text-cyan-300">{stationLabel || "Puesto"} | Oficial activo: {actingOfficerName}</p>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Puesto</Label>
              <Input
                value={effectivePostName}
                onChange={(event) => {
                  if (!stationModeEnabled) setPostName(event.target.value)
                }}
                disabled={stationModeEnabled}
                placeholder="Ej: Puesto Norte"
                className="bg-black/30 border-white/15 text-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-white/80 text-xs">Categoría</Label>
                <Select value={category} onValueChange={(value: NoteCategory) => setCategory(value)}>
                  <SelectTrigger className="bg-black/30 border-white/15 text-white">
                    <SelectValue placeholder="Categoría" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="suministros">Suministros</SelectItem>
                    <SelectItem value="equipo">Equipo</SelectItem>
                    <SelectItem value="infraestructura">Infraestructura</SelectItem>
                    <SelectItem value="otro">Otro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-white/80 text-xs">Prioridad</Label>
                <Select value={priority} onValueChange={(value: NotePriority) => setPriority(value)}>
                  <SelectTrigger className="bg-black/30 border-white/15 text-white">
                    <SelectValue placeholder="Prioridad" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="baja">Baja</SelectItem>
                    <SelectItem value="media">Media</SelectItem>
                    <SelectItem value="alta">Alta</SelectItem>
                    <SelectItem value="critica">Crítica</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-white/80 text-xs">Detalle de la novedad</Label>
            <Textarea
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="Describe faltantes, daños o requerimientos del puesto..."
              className="bg-black/30 border-white/15 text-white min-h-24"
            />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleCreateNote} disabled={isSaving}>
              {isSaving ? "Guardando..." : "Registrar anotación"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Pendientes y seguimiento</CardTitle>
            <CardDescription className="text-white/60 text-xs">Control interno independiente de boletas.</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleExportPdf()}
            disabled={sortedNotes.length === 0}
            className="h-9 shrink-0 gap-2 border-white/15 bg-white/5 text-[10px] font-black uppercase text-white hover:bg-white/10"
          >
            <FileDown className="h-4 w-4" />
            PDF
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedNotes.length === 0 ? (
            <div className="text-xs text-white/60 border border-white/10 rounded p-3">No hay anotaciones registradas.</div>
          ) : (
            sortedNotes.map((note) => {
              const createdAt = toDate(note.createdAt)
              const status = String(note.status ?? "abierta") as NoteStatus
              const overdue = isNoteOverdue(note.createdAt, note.status)
              const statusLabel =
                status === "resuelta" ? "Resuelta" : status === "en_proceso" ? "En proceso" : "Abierta"

              return (
                <div
                  key={String(note.id)}
                  className={`border rounded p-3 space-y-2 ${overdue ? "border-red-500/60 bg-red-950/20" : "border-white/10"}`}
                >
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="text-xs text-white">
                      <span className="font-bold">{String(note.postName ?? "—")}</span>
                      <span className="text-white/50"> · {String(note.category ?? "otro")}</span>
                      <span className="text-white/50"> · {String(note.priority ?? "media")}</span>
                      {overdue ? <span className="text-red-300"> · VENCIDA</span> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {canResolve ? (
                        <>
                          <Select
                            value={String(note.assignedToUserId || UNASSIGNED_USER_VALUE)}
                            onValueChange={(value) => void handleAssignNote(String(note.id), value, true)}
                            disabled={assignmentBusyNoteId === String(note.id) || status === "resuelta"}
                          >
                            <SelectTrigger className="w-[190px] bg-black/30 border-white/15 text-white h-8 text-xs">
                              <SelectValue placeholder="Asignar L2/L3" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED_USER_VALUE}>Sin responsable</SelectItem>
                              {assignees.map((assignee) => (
                                <SelectItem key={assignee.id} value={assignee.id}>
                                  {assignee.name} · L{assignee.roleLevel}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 border-amber-300/20 bg-amber-300/10 text-amber-200 hover:bg-amber-300/20"
                            title="Reenviar alerta al responsable"
                            disabled={!note.assignedToUserId || assignmentBusyNoteId === String(note.id) || status === "resuelta"}
                            onClick={() => void handleAssignNote(String(note.id), String(note.assignedToUserId), true)}
                          >
                            <BellRing className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : null}
                      <Select
                        value={status}
                        onValueChange={(value: NoteStatus) => void handleUpdateStatus(String(note.id), value)}
                        disabled={!canResolve}
                      >
                        <SelectTrigger className="w-[160px] bg-black/30 border-white/15 text-white h-8 text-xs">
                          <SelectValue placeholder={statusLabel} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="abierta">Abierta</SelectItem>
                          <SelectItem value="en_proceso">En proceso</SelectItem>
                          <SelectItem value="resuelta">Resuelta</SelectItem>
                        </SelectContent>
                      </Select>
                      {canResolve && status === "resuelta" ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleDeleteResolved(String(note.id), status)}
                        >
                          Borrar
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <p className="text-sm text-white/85">{String(note.detail ?? "")}</p>

                  <div className="text-[11px] text-white/50 flex flex-wrap gap-2">
                    <span>Reportó: {String(note.reportedByName ?? note.reportedByEmail ?? "Sin nombre")}</span>
                    <span>·</span>
                    <span>{createdAt ? createdAt.toLocaleString() : "Sin fecha"}</span>
                    <span>·</span>
                    <span>Estado: {statusLabel}</span>
                    {note.assignedTo ? (
                      <>
                        <span>·</span>
                        <span>Atiende: {String(note.assignedTo)}</span>
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })
          )}
        </CardContent>
      </Card>
    </div>
  )
}
