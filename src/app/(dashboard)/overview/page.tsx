"use client"

import { useMemo, useState } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useCollection, useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { nowIso, toSnakeCaseKeys } from "@/lib/supabase-db"
import { MapPin } from "lucide-react"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)

function isSameLocalDay(date: Date, now: Date) {
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  )
}

function toDateSafe(value: unknown) {
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

function parseGpsPoint(raw: unknown): { lat: number; lng: number } | null {
  if (!raw) return null

  const parseNumber = (v: unknown) => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null
    if (typeof v === "string") {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }

  const fromObject = (obj: Record<string, unknown>) => {
    const lat = parseNumber(obj.lat ?? obj.latitude)
    const lng = parseNumber(obj.lng ?? obj.lon ?? obj.long ?? obj.longitude)
    if (lat === null || lng === null) return null
    return { lat, lng }
  }

  if (typeof raw === "object") {
    return fromObject(raw as Record<string, unknown>)
  }

  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return fromObject(parsed)
    } catch {
      return null
    }
  }

  return null
}

function hasAmmoColumnError(message?: string) {
  const normalized = String(message ?? "").toLowerCase()
  return normalized.includes("ammo_count") || normalized.includes("ammocount")
}

export default function OverviewPage() {
  const { user } = useUser()
  const { supabase } = useSupabase()
  const { toast } = useToast()
  const [weaponSerialQuery, setWeaponSerialQuery] = useState("")
  const [targetPost, setTargetPost] = useState("")
  const [targetAmmoCount, setTargetAmmoCount] = useState("0")
  const [adjustmentReason, setAdjustmentReason] = useState<"cambio" | "dano" | "traslado">("cambio")
  const [isSavingWeapon, setIsSavingWeapon] = useState(false)
  const canUseWeaponDashboardControl = (user?.roleLevel ?? 0) >= 2

  const supervisionSelect = "id,created_at,gps,review_post,officer_name,status,operation_name"
  const { data: supervisions } = useCollection(user ? "supervisions" : null, {
    select: supervisionSelect,
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const incidentsSelect = "id,time,created_at,status,priority_level,title"
  const { data: incidents } = useCollection(user ? "incidents" : null, {
    select: incidentsSelect,
    orderBy: "time",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const roundsSelect = "id,created_at,status,checkpoints_total,checkpoints_completed,post_name,officer_name"
  const { data: roundReports } = useCollection(user ? "round_reports" : null, {
    select: roundsSelect,
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const weaponsSelect = "id,model,serial,status,assigned_to,ammo_count"
  const { data: weapons } = useCollection(canUseWeaponDashboardControl ? "weapons" : null, {
    select: weaponsSelect,
    orderBy: "serial",
    orderDesc: false,
    realtime: false,
    pollingMs: 120000,
  })

  const todaySupervisions = useMemo(() => {
    const now = new Date()
    return (supervisions ?? []).filter((row) => {
      const d = toDateSafe(row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [supervisions])

  const todayIncidents = useMemo(() => {
    const now = new Date()
    return (incidents ?? []).filter((row) => {
      const d = toDateSafe(row.time ?? row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [incidents])

  const todayRounds = useMemo(() => {
    const now = new Date()
    return (roundReports ?? []).filter((row) => {
      const d = toDateSafe(row.createdAt)
      return !!d && isSameLocalDay(d, now)
    })
  }, [roundReports])

  const criticalIncidents = useMemo(
    () => todayIncidents.filter((i) => String(i.priorityLevel ?? "").toLowerCase() === "critical").length,
    [todayIncidents]
  )

  const welcomeOperation = useMemo(() => {
    const counts = new Map<string, number>()
    todaySupervisions.forEach((r) => {
      const op = String(r.operationName ?? "").trim()
      if (!op) return
      counts.set(op, (counts.get(op) ?? 0) + 1)
    })
    if (counts.size === 0) return "OPERACION GENERAL"
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]
  }, [todaySupervisions])

  const visitMarkers = useMemo(() => {
    return todaySupervisions
      .map((r) => {
        const gps = parseGpsPoint(r.gps)
        if (!gps) return null
        const status = String(r.status ?? "")
        return {
          lng: gps.lng,
          lat: gps.lat,
          color: status.includes("NOVEDAD") ? "#ef4444" : "#10b981",
          title: `${String(r.reviewPost ?? "Punto")} | ${String(r.officerName ?? "Oficial")}`,
        }
      })
      .filter(Boolean) as Array<{ lng: number; lat: number; color: string; title: string }>
  }, [todaySupervisions])

  const mapCenter = useMemo<[number, number]>(() => {
    if (!visitMarkers.length) return [-84.0907, 9.9281]
    const first = visitMarkers[0]
    return [first.lng, first.lat]
  }, [visitMarkers])

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
    if (!canUseWeaponDashboardControl) {
      toast({ title: "Sin permiso", description: "Este control es solo para supervisores.", variant: "destructive" })
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

    toast({
      title: result.queued ? "Cambio en cola" : "Control registrado",
      description: result.queued
        ? "Sin conexion: se sincronizara al reconectar."
        : `Arma ${String(selectedWeapon.serial ?? "")} actualizada con exito.`,
    })
  }

  return (
    <div className="p-4 md:p-10 space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Supervisiones hoy</p>
            <p className="text-3xl font-black text-white">{todaySupervisions.length}</p>
            <p className="text-xs text-white/60">Visitas reportadas en campo durante el dia.</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Incidentes hoy</p>
            <p className="text-3xl font-black text-white">{todayIncidents.length}</p>
            <p className="text-xs text-white/60">Criticos abiertos hoy: <span className="font-black text-red-400">{criticalIncidents}</span></p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <p className="text-[10px] uppercase font-black tracking-wider text-white/60">Rondas hoy</p>
            <p className="text-3xl font-black text-white">{todayRounds.length}</p>
            <p className="text-xs text-white/60">Boletas ejecutadas y registradas hoy.</p>
          </CardContent>
        </Card>
      </div>

      {canUseWeaponDashboardControl ? (
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Control rapido de armas (supervision)</CardTitle>
            <CardDescription className="text-white/60 text-xs">
              Consulta por matricula y actualiza asignacion, estado y municiones desde el dashboard.
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
                  list="overview-supervision-posts"
                  value={targetPost}
                  onChange={(event) => setTargetPost(event.target.value)}
                  placeholder="Selecciona o escribe"
                  className="bg-black/30 border-white/15 text-white"
                />
                <datalist id="overview-supervision-posts">
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
      ) : null}

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
            <MapPin className="w-4 h-4 text-primary" />
            Mapa simple de visitas del dia (GPS)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[320px] rounded border border-white/10 overflow-hidden">
            <TacticalMap center={mapCenter} zoom={10} markers={visitMarkers} className="w-full h-full" />
          </div>
          <div className="flex flex-wrap items-center gap-4 mt-3 text-[10px] uppercase font-black text-white/70">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> Cumplim</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" /> Con novedad</span>
            <span className="text-white/50">Total puntos GPS hoy: {visitMarkers.length}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
