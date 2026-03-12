"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Loader2 } from "lucide-react"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { useToast } from "@/hooks/use-toast"

type CheckpointDraft = {
  name: string
  qrCodesText: string
  nfcCodesText: string
  lat: string
  lng: string
}

export default function NewRoundPage() {
  const router = useRouter()
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()

  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [post, setPost] = useState("")
  const [status, setStatus] = useState("Activa")
  const [frequency, setFrequency] = useState("Cada 30 minutos")
  const [operationName, setOperationName] = useState("")
  const [instructions, setInstructions] = useState("")
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>([{ name: "", qrCodesText: "", nfcCodesText: "", lat: "", lng: "" }])

  const { data: operationCatalog } = useCollection<{ operationName?: string; clientName?: string; isActive?: boolean }>(
    user ? "operation_catalog" : null,
    { select: "operation_name,client_name,is_active", orderBy: "operation_name", orderDesc: false, realtime: false, pollingMs: 180000 }
  )

  const activeCatalog = useMemo(
    () =>
      (operationCatalog ?? [])
        .filter((o) => o.isActive !== false)
        .map((o) => ({
          operationName: String(o.operationName ?? "").trim(),
          clientName: String(o.clientName ?? "").trim(),
        }))
        .filter((o) => o.operationName),
    [operationCatalog]
  )

  const operationOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((o) => o.operationName))).filter(Boolean),
    [activeCatalog]
  )

  const postOptions = useMemo(
    () => Array.from(new Set(activeCatalog.filter((o) => o.operationName === operationName).map((o) => o.clientName).filter(Boolean))),
    [activeCatalog, operationName]
  )

  const isPostValidForOperation = !operationName || postOptions.length === 0 || postOptions.includes(post)

  const addCheckpoint = () => {
    setCheckpoints((prev) => [...prev, { name: "", qrCodesText: "", nfcCodesText: "", lat: "", lng: "" }])
  }

  const removeCheckpoint = (index: number) => {
    setCheckpoints((prev) => prev.filter((_, i) => i !== index))
  }

  const updateCheckpoint = (index: number, field: keyof CheckpointDraft, value: string) => {
    setCheckpoints((prev) => prev.map((cp, i) => (i === index ? { ...cp, [field]: value } : cp)))
  }

  const createRoundId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  const handleSave = async () => {
    if (!user) {
      toast({ title: "Sesion requerida", description: "Inicie sesion para crear una ronda.", variant: "destructive" })
      return
    }

    const cleanName = name.trim()
    const cleanPost = (isPostValidForOperation ? post : "").trim()

    if (!cleanName || !cleanPost) {
      toast({ title: "Campos requeridos", description: "Nombre de ronda y puesto son obligatorios.", variant: "destructive" })
      return
    }

    const validCheckpoints = checkpoints
      .map((cp) => ({
        name: cp.name.trim(),
        qrCodes: cp.qrCodesText.split(",").map((x) => x.trim()).filter(Boolean),
        nfcCodes: cp.nfcCodesText.split(",").map((x) => x.trim()).filter(Boolean),
        lat: Number(cp.lat),
        lng: Number(cp.lng),
      }))
      .filter((cp) => cp.name)
    const invalidGeo = validCheckpoints.find(
      (cp) => !Number.isFinite(cp.lat) || !Number.isFinite(cp.lng) || Math.abs(cp.lat) > 90 || Math.abs(cp.lng) > 180 || (cp.lat === 0 && cp.lng === 0)
    )
    if (invalidGeo) {
      toast({ title: "Coordenadas invalidas", description: "Cada checkpoint requiere latitud/longitud valida (no 0,0).", variant: "destructive" })
      return
    }


    if (!validCheckpoints.length) {
      toast({ title: "Checkpoint requerido", description: "Agregue al menos un checkpoint con nombre.", variant: "destructive" })
      return
    }

    setSaving(true)
    const roundId = createRoundId()

    const payload = toSnakeCaseKeys({
      id: roundId,
      name: cleanName,
      post: cleanPost,
      status,
      frequency,
      operationId: operationName || undefined,
      puestoBase: cleanPost,
      instructions: instructions.trim() || undefined,
      checkpoints: validCheckpoints.map((cp) => ({
        name: cp.name,
        lat: cp.lat,
        lng: cp.lng,
        qrCodes: cp.qrCodes,
        nfcCodes: cp.nfcCodes,
      })),
      createdAt: nowIso(),
    }) as Record<string, unknown>

    const result = await runMutationWithOffline(supabase, {
      table: "rounds",
      action: "insert",
      payload,
    })

    setSaving(false)

    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }

    toast({
      title: result.queued ? "Ronda en cola" : "Ronda creada",
      description: result.queued
        ? "Sin conexion: se sincronizara automaticamente al reconectar."
        : "La ronda se guardo correctamente.",
    })

    router.push(`/rounds?roundId=${encodeURIComponent(roundId)}`)
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm md:text-base font-black uppercase tracking-wider text-white">Nueva ronda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Nombre de ronda</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: RONDA NOCTURNA NORTE" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
              <Input value={post} onChange={(e) => setPost(e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: ACCESO PRINCIPAL" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Frecuencia</Label>
              <Select value={frequency} onValueChange={setFrequency}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cada 15 minutos">Cada 15 minutos</SelectItem>
                  <SelectItem value="Cada 30 minutos">Cada 30 minutos</SelectItem>
                  <SelectItem value="Cada 60 minutos">Cada 60 minutos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activa">Activa</SelectItem>
                  <SelectItem value="Inactiva">Inactiva</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Operacion (opcional)</Label>
              <Select value={operationName} onValueChange={setOperationName}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccionar operacion" /></SelectTrigger>
                <SelectContent>
                  {operationOptions.map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {operationName && postOptions.length > 0 ? (
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[10px] uppercase font-black text-white/70">Puesto/Lugar de la operacion</Label>
                <Select value={isPostValidForOperation ? post : ""} onValueChange={setPost}>
                  <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccionar puesto/lugar" /></SelectTrigger>
                  <SelectContent>
                    {postOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-black text-white/70">Instrucciones (opcional)</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} className="bg-black/30 border-white/10 min-h-[80px]" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Checkpoints</Label>
              <Button type="button" onClick={addCheckpoint} variant="outline" className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase gap-1">
                <Plus className="w-3.5 h-3.5" /> Agregar
              </Button>
            </div>

            <div className="space-y-2">
              {checkpoints.map((cp, index) => (
                <div key={`cp-${index}`} className="rounded border border-white/10 bg-black/20 p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_140px_140px_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">Nombre checkpoint</Label>
                    <Input value={cp.name} onChange={(e) => updateCheckpoint(index, "name", e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: PORTON NORTE" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">QRs (coma)</Label>
                    <Input value={cp.qrCodesText} onChange={(e) => updateCheckpoint(index, "qrCodesText", e.target.value)} className="bg-black/30 border-white/10" placeholder="QR001, QR002" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">NFC IDs (coma)</Label>
                    <Input value={cp.nfcCodesText} onChange={(e) => updateCheckpoint(index, "nfcCodesText", e.target.value)} className="bg-black/30 border-white/10" placeholder="NFC001, 04AABBCCDD" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">Latitud</Label>
                    <Input value={cp.lat} onChange={(e) => updateCheckpoint(index, "lat", e.target.value)} className="bg-black/30 border-white/10" placeholder="9.93218" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">Longitud</Label>
                    <Input value={cp.lng} onChange={(e) => updateCheckpoint(index, "lng", e.target.value)} className="bg-black/30 border-white/10" placeholder="-84.07895" />
                  </div>
                  <Button
                    type="button"
                    onClick={() => removeCheckpoint(index)}
                    variant="ghost"
                    disabled={checkpoints.length <= 1}
                    className="h-10 text-white/50 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="ghost" onClick={() => router.push("/rounds")} className="h-11 font-black uppercase">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="h-11 bg-primary text-black font-black uppercase gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Crear ronda
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
