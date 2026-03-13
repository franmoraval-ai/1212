"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { nowIso, toSnakeCaseKeys } from "@/lib/supabase-db"

type NoteCategory = "suministros" | "equipo" | "infraestructura" | "otro"
type NotePriority = "baja" | "media" | "alta" | "critica"
type NoteStatus = "abierta" | "en_proceso" | "resuelta"
const INTERNAL_NOTES_SLA_HOURS = Math.max(1, Number(process.env.NEXT_PUBLIC_INTERNAL_NOTES_SLA_HOURS ?? 24))

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
  const { toast } = useToast()
  const canResolve = (appUser?.roleLevel ?? 1) >= 2

  const [postName, setPostName] = useState("")
  const [category, setCategory] = useState<NoteCategory>("suministros")
  const [priority, setPriority] = useState<NotePriority>("media")
  const [detail, setDetail] = useState("")
  const [isSaving, setIsSaving] = useState(false)

  const { data: notes } = useCollection(user ? "internal_notes" : null, {
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 45000,
  })

  const openCount = useMemo(
    () => (notes ?? []).filter((note) => String(note.status ?? "abierta") !== "resuelta").length,
    [notes]
  )
  const overdueCount = useMemo(
    () => (notes ?? []).filter((note) => isNoteOverdue(note.createdAt, note.status)).length,
    [notes]
  )

  const sortedNotes = notes ?? []

  const resetForm = () => {
    setPostName("")
    setCategory("suministros")
    setPriority("media")
    setDetail("")
  }

  const handleCreateNote = async () => {
    if (!postName.trim() || !detail.trim()) {
      toast({ title: "Datos incompletos", description: "Puesto y detalle son obligatorios.", variant: "destructive" })
      return
    }

    setIsSaving(true)
    const payload = toSnakeCaseKeys({
      postName: postName.trim(),
      category,
      priority,
      detail: detail.trim(),
      status: "abierta",
      reportedByUserId: appUser?.uid ?? null,
      reportedByName: appUser?.firstName ?? null,
      reportedByEmail: appUser?.email ?? null,
      assignedTo: null,
      resolutionNote: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      resolvedAt: null,
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, {
      table: "internal_notes",
      action: "insert",
      payload,
    })
    setIsSaving(false)

    if (!result.ok) {
      toast({ title: "No se pudo guardar", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Registro en cola" : "Anotación creada",
      description: result.queued ? "Se sincronizará al reconectar." : "La novedad interna fue registrada.",
    })
    resetForm()
  }

  const handleUpdateStatus = async (noteId: string, nextStatus: NoteStatus) => {
    if (!canResolve) {
      toast({ title: "Sin permiso", description: "Solo L2-L4 pueden cambiar estado.", variant: "destructive" })
      return
    }

    const payload = toSnakeCaseKeys({
      status: nextStatus,
      resolvedAt: nextStatus === "resuelta" ? nowIso() : null,
      updatedAt: nowIso(),
      assignedTo: appUser?.firstName || appUser?.email || "Supervisor",
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, {
      table: "internal_notes",
      action: "update",
      payload,
      match: { id: noteId },
    })

    if (!result.ok) {
      toast({ title: "No se pudo actualizar", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Cambio en cola" : "Estado actualizado",
      description: result.queued ? "Se aplicará al reconectar." : "La anotación fue actualizada.",
    })
  }

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Novedades internas de puestos</CardTitle>
          <CardDescription className="text-white/60 text-xs">
            Registro interno de faltantes, suministros y observaciones operativas. Pendientes sin resolver: {openCount} · Vencidas SLA ({INTERNAL_NOTES_SLA_HOURS}h): {overdueCount}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Puesto</Label>
              <Input
                value={postName}
                onChange={(event) => setPostName(event.target.value)}
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
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Pendientes y seguimiento</CardTitle>
          <CardDescription className="text-white/60 text-xs">Control interno independiente de boletas.</CardDescription>
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
