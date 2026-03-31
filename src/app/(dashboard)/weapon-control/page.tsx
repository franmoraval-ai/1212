"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"

export default function WeaponControlPage() {
  const { user } = useUser()
  const { toast } = useToast()
  const [weaponSerialQuery, setWeaponSerialQuery] = useState("")
  const [targetPost, setTargetPost] = useState("")
  const [targetAmmoCount, setTargetAmmoCount] = useState("0")
  const [adjustmentReason, setAdjustmentReason] = useState<"cambio" | "dano" | "traslado">("cambio")
  const [isSavingWeapon, setIsSavingWeapon] = useState(false)

  const isL2 = (user?.roleLevel ?? 0) === 2

  const supervisionSelect = "review_post"
  const { data: supervisions } = useCollection(isL2 ? "supervisions" : null, {
    select: supervisionSelect,
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const weaponsSelect = "id,model,serial,status,assigned_to,ammo_count"
  const { data: weapons } = useCollection(isL2 ? "weapons" : null, {
    select: weaponsSelect,
    orderBy: "serial",
    orderDesc: false,
    realtime: false,
    pollingMs: 120000,
  })

  const suggestedPosts = useMemo(() => {
    const uniquePosts = new Set<string>()
    ;(supervisions ?? []).forEach((row) => {
      const post = String(row.reviewPost ?? "").trim()
      if (post) uniquePosts.add(post)
    })
    return Array.from(uniquePosts).slice(0, 40)
  }, [supervisions])

  const selectedWeapon = useMemo(() => {
    const serial = weaponSerialQuery.trim().toLowerCase()
    if (!serial) return null
    const source = weapons ?? []
    const exact = source.find((item) => String(item.serial ?? "").trim().toLowerCase() === serial)
    if (exact) return exact
    return source.find((item) => String(item.serial ?? "").trim().toLowerCase().includes(serial)) ?? null
  }, [weaponSerialQuery, weapons])

  const normalizedAssignedTo = String(selectedWeapon?.assignedTo ?? "").trim()
  const normalizedTargetPost = targetPost.trim()
  const isAssignmentMatch = useMemo(() => {
    if (!selectedWeapon || !normalizedTargetPost) return true
    const assigned = normalizedAssignedTo.toLowerCase()
    const target = normalizedTargetPost.toLowerCase()
    return assigned.includes(target) || target.includes(assigned)
  }, [normalizedAssignedTo, normalizedTargetPost, selectedWeapon])

  const handleSaveWeaponControl = async () => {
    if (!isL2) {
      toast({ title: "Sin permiso", description: "Este modulo es exclusivo para nivel L2.", variant: "destructive" })
      return
    }
    if (!selectedWeapon?.id) {
      toast({ title: "Arma no encontrada", description: "Ingresa una matricula valida para continuar.", variant: "destructive" })
      return
    }
    if (!normalizedTargetPost) {
      toast({ title: "Puesto requerido", description: "Ingresa o selecciona el puesto objetivo.", variant: "destructive" })
      return
    }

    const ammoParsed = Number(targetAmmoCount)
    if (!Number.isFinite(ammoParsed) || ammoParsed < 0) {
      toast({ title: "Municiones invalidas", description: "Debes indicar un numero mayor o igual a 0.", variant: "destructive" })
      return
    }

    setIsSavingWeapon(true)
    const normalizedAmmo = Math.trunc(ammoParsed)
    try {
      const response = await fetch("/api/weapon-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          weaponId: selectedWeapon.id,
          targetPost: normalizedTargetPost,
          ammoCount: normalizedAmmo,
          reason: adjustmentReason,
        }),
      })

      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; warning?: string }
      if (!response.ok || !data.ok) {
        toast({
          title: "No se pudo guardar",
          description: String(data.error ?? "No se pudo aplicar el control rápido de armas."),
          variant: "destructive",
        })
        return
      }

      if (data.warning) {
        toast({
          title: "Control aplicado con observación",
          description: data.warning,
          variant: "destructive",
        })
      }

      toast({
        title: "Control registrado",
        description: `Arma ${String(selectedWeapon.serial ?? "")} actualizada con exito.`,
      })
    } catch {
      toast({
        title: "No se pudo guardar",
        description: "Se requiere conexión para aplicar el control rápido de armas.",
        variant: "destructive",
      })
    } finally {
      setIsSavingWeapon(false)
    }
  }

  if (!isL2) {
    return (
      <div className="p-4 md:p-8 max-w-4xl mx-auto">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Control rapido de armas</CardTitle>
            <CardDescription className="text-white/60 text-xs">Acceso restringido: este modulo es exclusivo para usuarios nivel L2.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Control rapido de armas</CardTitle>
          <CardDescription className="text-white/60 text-xs">
            Consulta por matricula y actualiza asignacion, estado y municiones.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Matricula</Label>
              <Input
                value={weaponSerialQuery}
                onChange={(event) => setWeaponSerialQuery(event.target.value)}
                placeholder="Ej: PX-1029"
                className="bg-black/30 border-white/15 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Puesto objetivo</Label>
              <Input
                list="weapon-control-posts"
                value={targetPost}
                onChange={(event) => setTargetPost(event.target.value)}
                placeholder="Selecciona o escribe"
                className="bg-black/30 border-white/15 text-white"
              />
              <datalist id="weapon-control-posts">
                {suggestedPosts.map((post) => (
                  <option key={post} value={post} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Municiones</Label>
              <Input
                type="number"
                min={0}
                value={targetAmmoCount}
                onChange={(event) => setTargetAmmoCount(event.target.value)}
                className="bg-black/30 border-white/15 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-white/80 text-xs">Motivo</Label>
              <Select value={adjustmentReason} onValueChange={(value: "cambio" | "dano" | "traslado") => setAdjustmentReason(value)}>
                <SelectTrigger className="bg-black/30 border-white/15 text-white">
                  <SelectValue placeholder="Motivo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cambio">Cambio</SelectItem>
                  <SelectItem value="dano">Daño</SelectItem>
                  <SelectItem value="traslado">Traslado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded border border-white/10 p-3 text-xs text-white/80 space-y-1">
            <p>
              <span className="text-white/60">Modelo:</span> {String(selectedWeapon?.model ?? "—")} · <span className="text-white/60">Serie:</span>{" "}
              {String(selectedWeapon?.serial ?? "—")}
            </p>
            <p>
              <span className="text-white/60">Asignada actual:</span> {normalizedAssignedTo || "—"} · <span className="text-white/60">Estado actual:</span>{" "}
              {String(selectedWeapon?.status ?? "—")} · <span className="text-white/60">Municiones actuales:</span>{" "}
              {String(selectedWeapon?.ammoCount ?? 0)}
            </p>
            {!isAssignmentMatch ? (
              <p className="text-amber-300">Advertencia: la asignacion actual no coincide con el puesto objetivo.</p>
            ) : null}
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSaveWeaponControl} disabled={!selectedWeapon || isSavingWeapon}>
              {isSavingWeapon ? "Guardando..." : "Registrar control"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
