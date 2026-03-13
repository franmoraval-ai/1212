"use client"

import { useMemo, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { nowIso, toSnakeCaseKeys } from "@/lib/supabase-db"

function hasAmmoColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("ammo_count") || normalized.includes("ammocount")
}

export default function WeaponControlPage() {
  const { user } = useUser()
  const { supabase } = useSupabase()
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
    const nextStatus = adjustmentReason === "dano" ? "Mantenimiento" : "Asignada"
    const normalizedAmmo = Math.trunc(ammoParsed)
    const row = toSnakeCaseKeys({
      assignedTo: normalizedTargetPost,
      status: nextStatus,
      ammoCount: normalizedAmmo,
      lastCheck: nowIso(),
    }) as Record<string, unknown>

    let result = await runMutationWithOffline(supabase, {
      table: "weapons",
      action: "update",
      payload: row,
      match: { id: selectedWeapon.id },
    })

    if (!result.ok && hasAmmoColumnError(result.error)) {
      const fallbackRow: Record<string, unknown> = { ...row, ammoCount: normalizedAmmo }
      delete fallbackRow["ammo_count"]
      result = await runMutationWithOffline(supabase, {
        table: "weapons",
        action: "update",
        payload: fallbackRow,
        match: { id: selectedWeapon.id },
      })
    }

    setIsSavingWeapon(false)
    if (!result.ok) {
      toast({
        title: "No se pudo guardar",
        description: hasAmmoColumnError(result.error)
          ? "Falta el campo ammo_count en BD. Ejecuta la migracion de municiones."
          : result.error,
        variant: "destructive",
      })
      return
    }

    const auditPayload = toSnakeCaseKeys({
      weaponId: selectedWeapon.id,
      weaponSerial: String(selectedWeapon.serial ?? ""),
      weaponModel: String(selectedWeapon.model ?? ""),
      changedByUserId: user?.uid ?? null,
      changedByEmail: user?.email ?? null,
      changedByName: user?.firstName ?? null,
      reason: adjustmentReason,
      previousData: {
        assignedTo: String(selectedWeapon.assignedTo ?? ""),
        status: String(selectedWeapon.status ?? ""),
        ammoCount: Number(selectedWeapon.ammoCount ?? 0),
      },
      newData: {
        assignedTo: normalizedTargetPost,
        status: nextStatus,
        ammoCount: normalizedAmmo,
      },
      createdAt: nowIso(),
    }) as Record<string, unknown>

    const auditResult = await runMutationWithOffline(supabase, {
      table: "weapon_control_logs",
      action: "insert",
      payload: auditPayload,
    })

    if (!auditResult.ok) {
      toast({
        title: "Control aplicado sin bitacora",
        description: "El arma se actualizo, pero no se pudo guardar la trazabilidad.",
        variant: "destructive",
      })
    }

    toast({
      title: result.queued ? "Cambio en cola" : "Control registrado",
      description: result.queued
        ? "Sin conexion: se sincronizara al reconectar."
        : `Arma ${String(selectedWeapon.serial ?? "")} actualizada con exito.`,
    })
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
