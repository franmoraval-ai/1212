"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BookText, Building2, Clock3, Loader2, RefreshCcw, ShieldCheck, UserRound, Users, XCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useOperationCatalogData } from "@/hooks/use-operation-catalog-data"
import { Label } from "@/components/ui/label"
import { useSupabase, useUser } from "@/supabase"
import { useStationShift } from "@/components/layout/station-shift-provider"
import { buildStationKey, resolveStationReference } from "@/lib/stations"
import { fetchInternalApi } from "@/lib/internal-api"
import { splitAssignedScope } from "@/lib/personnel-assignment"
import { useToast } from "@/hooks/use-toast"

type ShiftHistoryEntry = {
  id: string
  stationLabel: string
  stationPostName: string
  officerUserId: string
  officerName: string
  officerEmail: string
  checkInAt: string | null
  checkOutAt: string | null
  workedMinutes: number
  notes: string
  createdByDeviceEmail: string
  createdAt: string | null
  isOpen: boolean
}

type OperationCatalogRow = {
  id: string
  operationName?: string
  clientName?: string
  isActive?: boolean
}

type AttendanceOfficerSummary = {
  officerUserId: string
  officerName: string
  officerEmail: string
  assigned: string
  status: string
  totalWorkedMinutes: number
  totalWorkedHours: number
  workedDays: number
  completedShifts: number
  openShifts: number
  lastCheckInAt: string | null
  lastCheckOutAt: string | null
  recentPosts: string[]
  recentNotesCount: number
  recentShifts: Array<{
    id: string
    stationLabel: string
    stationPostName: string
    checkInAt: string | null
    checkOutAt: string | null
    workedMinutes: number
    notes: string
    isOpen: boolean
  }>
}

type AttendanceSummaryResponse = {
  windowDays: number
  generatedAt?: string
  summary: {
    officers: number
    totalWorkedMinutes: number
    totalWorkedHours: number
    totalWorkedDays: number
    totalCompletedShifts: number
    totalOpenShifts: number
    averageWorkedHours: number
  }
  officers: AttendanceOfficerSummary[]
  error?: string
}

type OpenShiftRecord = {
  id: string
  stationKey: string
  operationName: string
  postName: string
  officerUserId: string
  officerName: string
  officerEmail: string
  assigned: string
  checkInAt: string | null
  notes: string
}

function formatShiftDuration(startedAt: string | null, endedAt: string | null) {
  if (!startedAt || !endedAt) return null
  const start = new Date(startedAt)
  const end = new Date(endedAt)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null

  const totalMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes} min`
  if (minutes === 0) return `${hours} h`
  return `${hours} h ${minutes} min`
}

function formatWorkedMinutes(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min"
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

function formatDateTime(value: string | null) {
  if (!value) return "Sin registro"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Sin registro"
  return date.toLocaleString()
}

function formatHoursValue(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "0 h"
  return `${hours.toFixed(hours >= 100 ? 0 : 1)} h`
}

function normalizeOperationName(value: unknown) {
  return String(value ?? "").trim().toUpperCase()
}

export default function ShiftBookPage() {
  const { supabase } = useSupabase()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const {
    stationLabel,
    stationPostName,
    stationProfileRegistered,
    stationProfileEnabled,
    stationDeviceLabel,
    stationProfileNotes,
  } = useStationShift()
  const roleLevel = Number(user?.roleLevel ?? 1) || 1
  const isL1Operator = roleLevel <= 1
  const isDirectorUser = roleLevel >= 4
  const [selectedStation, setSelectedStation] = useState(stationPostName || stationLabel || "")
  const [history, setHistory] = useState<ShiftHistoryEntry[]>([])
  const [activeShift, setActiveShift] = useState<ShiftHistoryEntry | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummaryResponse | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceMessage, setAttendanceMessage] = useState<string | null>(null)
  const [closingShiftId, setClosingShiftId] = useState<string | null>(null)

  const { operations } = useOperationCatalogData()

  useEffect(() => {
    const nextStation = stationPostName || stationLabel
    if (!nextStation) return
    setSelectedStation((current) => current || nextStation)
  }, [stationLabel, stationPostName])

  const loadHistory = useCallback(async () => {
    if (!selectedStation.trim()) return
    setLoading(true)
    try {
      const canonicalStation = resolveStationReference({ assigned: user?.assigned, stationLabel: selectedStation.trim() })
      const response = await fetchInternalApi(supabase, `/api/shifts?stationLabel=${encodeURIComponent(canonicalStation.label)}&stationPostName=${encodeURIComponent(canonicalStation.postName)}`, {
        method: "GET",
      })
      const data = (await response.json()) as { history?: ShiftHistoryEntry[]; activeShift?: ShiftHistoryEntry | null; message?: string | null; error?: string }
      if (!response.ok) {
        setHistory([])
        setActiveShift(null)
        setMessage(String(data.error ?? "No se pudo cargar el libro de turno."))
        return
      }
      setHistory(Array.isArray(data.history) ? data.history : [])
      setActiveShift(data.activeShift ?? null)
      setMessage(data.message ?? null)
    } catch {
      setHistory([])
      setActiveShift(null)
      setMessage("No se pudo cargar el libro de turno.")
    } finally {
      setLoading(false)
    }
  }, [selectedStation, supabase, user?.assigned])

  const loadAttendanceSummary = useCallback(async () => {
    if (!user || isL1Operator) {
      setAttendanceSummary(null)
      setAttendanceMessage(null)
      return
    }

    setAttendanceLoading(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/personnel/attendance-summary?days=30", {
        method: "GET",
      })
      const result = (await response.json()) as AttendanceSummaryResponse
      if (!response.ok) {
        setAttendanceSummary(null)
        setAttendanceMessage(String(result.error ?? "No se pudieron cargar métricas operativas."))
        return
      }
      setAttendanceSummary(result)
      setAttendanceMessage(null)
    } catch {
      setAttendanceSummary(null)
      setAttendanceMessage("No se pudieron cargar métricas operativas.")
    } finally {
      setAttendanceLoading(false)
    }
  }, [isL1Operator, supabase, user])

  const closeShiftAsDirector = useCallback(async (entry: { id: string; postName: string; officerName: string }) => {
    if (!isDirectorUser) return

    const confirmed = window.confirm(`Se cerrará manualmente el turno abierto de ${entry.officerName} en ${entry.postName}.`)
    if (!confirmed) return

    setClosingShiftId(entry.id)
    try {
      const response = await fetchInternalApi(supabase, "/api/shifts", {
        method: "POST",
        body: JSON.stringify({
          action: "check_out",
          stationLabel: entry.postName,
          stationPostName: entry.postName,
          activeShiftId: entry.id,
          notes: "Cierre manual por contingencia operativa.",
        }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) {
        toast({
          title: "No se pudo cerrar el turno",
          description: String(result.error ?? "Error inesperado cerrando turno manual L4."),
          variant: "destructive",
        })
        return
      }

      toast({
        title: "Turno cerrado",
        description: `${entry.officerName} fue cerrado manualmente en ${entry.postName}.`,
      })

      if (selectedStation.trim().toLowerCase() === entry.postName.trim().toLowerCase()) {
        await loadHistory()
      }
      await loadAttendanceSummary()
    } catch {
      toast({
        title: "No se pudo cerrar el turno",
        description: "Error inesperado cerrando turno manual L4.",
        variant: "destructive",
      })
    } finally {
      setClosingShiftId(null)
    }
  }, [isDirectorUser, loadAttendanceSummary, loadHistory, selectedStation, supabase, toast])

  useEffect(() => {
    if (!selectedStation.trim()) return
    void loadHistory()
  }, [loadHistory, selectedStation])

  useEffect(() => {
    if (!user || isL1Operator) return
    void loadAttendanceSummary()
  }, [isL1Operator, loadAttendanceSummary, user])

  const latestEntry = useMemo(() => history[0] ?? null, [history])
  const notedEntries = useMemo(() => history.filter((entry) => entry.notes.trim()), [history])
  const latestNote = useMemo(() => notedEntries[0] ?? null, [notedEntries])

  const activeOperations = useMemo(
    () => (operations ?? []).filter((item) => item.isActive !== false),
    [operations]
  )

  const uniquePostKeyByName = useMemo(() => {
    const counts = new Map<string, number>()
    const keys = new Map<string, string>()

    for (const item of activeOperations) {
      const postName = String(item.clientName ?? "").trim().toLowerCase()
      if (!postName) continue
      counts.set(postName, (counts.get(postName) ?? 0) + 1)
      keys.set(postName, buildStationKey(item.operationName, item.clientName))
    }

    const result = new Map<string, string>()
    for (const [postName, count] of counts.entries()) {
      if (count === 1) {
        const key = keys.get(postName)
        if (key) result.set(postName, key)
      }
    }
    return result
  }, [activeOperations])

  const activeOperationCount = useMemo(
    () => new Set(activeOperations.map((item) => normalizeOperationName(item.operationName)).filter(Boolean)).size,
    [activeOperations]
  )

  const openShiftRoster = useMemo<OpenShiftRecord[]>(() => {
    const rows: OpenShiftRecord[] = []

    for (const officer of attendanceSummary?.officers ?? []) {
      const assignedScope = splitAssignedScope(officer.assigned)
      for (const shift of officer.recentShifts ?? []) {
        if (!shift.isOpen) continue

        const rawStationLabel = String(shift.stationLabel ?? "").trim()
        const rawPostName = String(shift.stationPostName ?? rawStationLabel).trim()
        const stationKey = rawStationLabel.includes("__")
          ? rawStationLabel
          : uniquePostKeyByName.get(rawPostName.toLowerCase()) ?? buildStationKey(assignedScope.operationName, rawPostName)

        rows.push({
          id: String(shift.id ?? `${officer.officerUserId}-${stationKey}`),
          stationKey,
          operationName: assignedScope.operationName || "SIN OPERACION",
          postName: rawPostName || "Puesto operativo",
          officerUserId: officer.officerUserId,
          officerName: officer.officerName,
          officerEmail: officer.officerEmail,
          assigned: officer.assigned,
          checkInAt: shift.checkInAt ?? null,
          notes: String(shift.notes ?? ""),
        })
      }
    }

    return rows.sort((left, right) => {
      const leftTime = left.checkInAt ? new Date(left.checkInAt).getTime() : 0
      const rightTime = right.checkInAt ? new Date(right.checkInAt).getTime() : 0
      return rightTime - leftTime
    })
  }, [attendanceSummary?.officers, uniquePostKeyByName])

  const openShiftByStationKey = useMemo(() => {
    const map = new Map<string, OpenShiftRecord>()
    for (const row of openShiftRoster) {
      if (!row.stationKey || map.has(row.stationKey)) continue
      map.set(row.stationKey, row)
    }
    return map
  }, [openShiftRoster])

  const operationHoursMap = useMemo(() => {
    const totals = new Map<string, number>()
    for (const officer of attendanceSummary?.officers ?? []) {
      const assignedScope = splitAssignedScope(officer.assigned)
      const operationName = normalizeOperationName(assignedScope.operationName)
      if (!operationName) continue
      totals.set(operationName, (totals.get(operationName) ?? 0) + Number(officer.totalWorkedMinutes ?? 0))
    }
    return totals
  }, [attendanceSummary?.officers])

  const activePostsBoard = useMemo(() => {
    return activeOperations
      .map((item) => {
        const operationName = String(item.operationName ?? "SIN OPERACION").trim() || "SIN OPERACION"
        const postName = String(item.clientName ?? "Puesto operativo").trim() || "Puesto operativo"
        const stationKey = buildStationKey(operationName, postName)
        return {
          id: String(item.id ?? stationKey),
          operationName,
          postName,
          stationKey,
          currentShift: openShiftByStationKey.get(stationKey) ?? null,
        }
      })
      .sort((left, right) => {
        const byOperation = left.operationName.localeCompare(right.operationName, "es", { sensitivity: "base" })
        if (byOperation !== 0) return byOperation
        return left.postName.localeCompare(right.postName, "es", { sensitivity: "base" })
      })
  }, [activeOperations, openShiftByStationKey])

  const operationBoards = useMemo(() => {
    const groups = new Map<string, {
      operationName: string
      posts: Array<{ id: string; postName: string; currentShift: OpenShiftRecord | null }>
      staffedPosts: number
      totalWorkedMinutes: number
    }>()

    for (const item of activePostsBoard) {
      const key = normalizeOperationName(item.operationName)
      if (!groups.has(key)) {
        groups.set(key, {
          operationName: item.operationName,
          posts: [],
          staffedPosts: 0,
          totalWorkedMinutes: operationHoursMap.get(key) ?? 0,
        })
      }

      const group = groups.get(key)!
      group.posts.push({ id: item.id, postName: item.postName, currentShift: item.currentShift })
      if (item.currentShift) group.staffedPosts += 1
    }

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        posts: group.posts.sort((left, right) => left.postName.localeCompare(right.postName, "es", { sensitivity: "base" })),
      }))
      .sort((left, right) => left.operationName.localeCompare(right.operationName, "es", { sensitivity: "base" }))
  }, [activePostsBoard, operationHoursMap])

  const summaryCards = useMemo(() => {
    return {
      activePosts: activeOperations.length,
      activeOperations: activeOperationCount,
      openShifts: openShiftRoster.length,
      workedHours: attendanceSummary?.summary?.totalWorkedHours ?? 0,
    }
  }, [activeOperationCount, activeOperations.length, attendanceSummary?.summary?.totalWorkedHours, openShiftRoster.length])

  if (isUserLoading) return null

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">LIBRO DE TURNO</h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            {isL1Operator ? "Historial de entrada y salida por puesto." : "Tablero operativo de puestos, horas laboradas y cobertura activa."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="border-white/20 text-white hover:bg-white/10 gap-2"
          onClick={() => {
            if (selectedStation.trim()) {
              void loadHistory()
            }
            if (!isL1Operator) {
              void loadAttendanceSummary()
            }
          }}
          disabled={loading || attendanceLoading}
        >
          {loading || attendanceLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />} Refrescar
        </Button>
      </div>

      {!isL1Operator ? (
        <>
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
              <p className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">PUESTOS ACTIVOS</p>
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{summaryCards.activePosts}</p>
            </Card>
            <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
              <p className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">OPERACIONES ACTIVAS</p>
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{summaryCards.activeOperations}</p>
            </Card>
            <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
              <p className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">QUIENES ESTAN EN ROL</p>
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{summaryCards.openShifts}</p>
            </Card>
            <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
              <p className="text-[9px] font-black text-amber-300 uppercase tracking-widest mb-1">HORAS LABORADAS 30D</p>
              <p className="text-2xl md:text-3xl font-black text-white tracking-tighter">{formatHoursValue(summaryCards.workedHours)}</p>
            </Card>
          </div>

          {attendanceMessage ? (
            <div className="rounded border border-amber-400/20 bg-amber-400/10 p-4 text-[11px] uppercase tracking-wide text-amber-100">
              {attendanceMessage}
            </div>
          ) : null}

          <div className="grid grid-cols-1 xl:grid-cols-[1.3fr_0.9fr] gap-6">
            <Card className="bg-[#0c0c0c] border-white/5">
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-primary" /> Puestos activos
                </CardTitle>
                <CardDescription className="text-white/60 text-xs">Estado operativo actual por puesto y oficial en rol.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {attendanceLoading && !attendanceSummary ? (
                  <div className="h-40 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : activePostsBoard.length === 0 ? (
                  <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">No hay puestos activos en catálogo.</div>
                ) : (
                  activePostsBoard.map((post) => (
                    <div key={post.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-2">
                      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                        <div>
                          <p className="text-[10px] uppercase text-white/45">{post.operationName}</p>
                          <p className="text-sm font-black uppercase text-white">{post.postName}</p>
                        </div>
                        <span className={`text-[10px] uppercase font-black ${post.currentShift ? "text-emerald-300" : "text-white/45"}`}>
                          {post.currentShift ? "CUBIERTO" : "SIN TURNO"}
                        </span>
                      </div>
                      {post.currentShift ? (
                        <div className="rounded border border-emerald-400/15 bg-emerald-400/10 p-3 space-y-1">
                          <p className="text-[10px] uppercase font-black text-emerald-200">Oficial en rol</p>
                          <p className="text-sm font-black uppercase text-white">{post.currentShift.officerName}</p>
                          <p className="text-[10px] uppercase text-white/60">Desde {formatDateTime(post.currentShift.checkInAt)}</p>
                          {post.currentShift.notes ? <p className="text-[11px] text-white/75 whitespace-pre-wrap">{post.currentShift.notes}</p> : null}
                          {isDirectorUser ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="mt-2 border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
                              disabled={closingShiftId === post.currentShift.id}
                              onClick={() => void closeShiftAsDirector({
                                id: post.currentShift!.id,
                                postName: post.postName,
                                officerName: post.currentShift!.officerName,
                              })}
                            >
                              {closingShiftId === post.currentShift.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cerrar turno
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-[10px] uppercase text-white/50">No hay oficial actualmente en turno para este puesto.</p>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="bg-[#0c0c0c] border-white/5">
              <CardHeader>
                <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" /> Quién está en rol
                </CardTitle>
                <CardDescription className="text-white/60 text-xs">Oficiales con turno abierto en este momento.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {attendanceLoading && !attendanceSummary ? (
                  <div className="h-32 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
                ) : openShiftRoster.length === 0 ? (
                  <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">No hay oficiales con turno abierto.</div>
                ) : (
                  openShiftRoster.map((entry) => (
                    <div key={entry.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-1">
                      <p className="text-[10px] uppercase text-cyan-200">{entry.operationName}</p>
                      <p className="text-sm font-black uppercase text-white">{entry.officerName}</p>
                      <p className="text-[10px] uppercase text-white/60">{entry.postName}</p>
                      <p className="text-[10px] uppercase text-white/45">Entrada {formatDateTime(entry.checkInAt)}</p>
                      {entry.notes ? <p className="text-[11px] text-white/70 whitespace-pre-wrap">{entry.notes}</p> : null}
                      {isDirectorUser ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="mt-2 border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
                          disabled={closingShiftId === entry.id}
                          onClick={() => void closeShiftAsDirector(entry)}
                        >
                          {closingShiftId === entry.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cerrar turno
                        </Button>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-primary" /> Operaciones activas
              </CardTitle>
              <CardDescription className="text-white/60 text-xs">Resumen por operación: puestos activos, cobertura y carga laboral acumulada.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {operationBoards.length === 0 ? (
                <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">No hay operaciones activas para mostrar.</div>
              ) : operationBoards.map((operation) => (
                <div key={operation.operationName} className="rounded border border-white/10 bg-black/20 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-black uppercase text-white">{operation.operationName}</p>
                      <p className="text-[10px] uppercase text-white/55">Puestos activos: {operation.posts.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-amber-200">Horas 30d</p>
                      <p className="text-lg font-black text-white">{formatWorkedMinutes(operation.totalWorkedMinutes)}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase text-white/45">Cubiertos</p>
                      <p className="text-xl font-black text-white">{operation.staffedPosts}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase text-white/45">Sin turno</p>
                      <p className="text-xl font-black text-white">{Math.max(0, operation.posts.length - operation.staffedPosts)}</p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {operation.posts.map((post) => (
                      <div key={post.id} className="flex items-center justify-between gap-3 rounded border border-white/10 bg-black/30 px-3 py-2">
                        <div>
                          <p className="text-[11px] font-black uppercase text-white">{post.postName}</p>
                          <p className="text-[10px] uppercase text-white/50">{post.currentShift ? post.currentShift.officerName : "Sin oficial en rol"}</p>
                        </div>
                        <span className={`text-[10px] uppercase font-black ${post.currentShift ? "text-emerald-300" : "text-white/45"}`}>
                          {post.currentShift ? "En rol" : "Libre"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Puesto</CardTitle>
          <CardDescription className="text-white/60 text-xs">
            {isL1Operator ? "El libro sigue el puesto operativo actual del dispositivo." : "Consulte un puesto específico para ver su turno actual e historial."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isL1Operator ? (
            <div className="rounded border border-white/10 bg-black/20 p-3 space-y-1">
              <p className="text-[10px] uppercase font-black text-white/50">Estado operativo</p>
              <p className="text-sm font-black uppercase text-white">
                {stationProfileRegistered
                  ? stationProfileEnabled
                    ? "L1 operativo habilitado"
                    : "L1 operativo pausado"
                  : "Pendiente de registro en L1 operativo"}
              </p>
              {stationDeviceLabel ? <p className="text-[10px] uppercase text-cyan-200">Dispositivo: {stationDeviceLabel}</p> : null}
              {stationProfileNotes ? <p className="text-[11px] text-white/60 whitespace-pre-wrap">{stationProfileNotes}</p> : null}
            </div>
          ) : null}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Puesto consultado</Label>
              <Input
                value={selectedStation}
                onChange={(event) => setSelectedStation(event.target.value)}
                className="bg-black/30 border-white/10 text-white"
                placeholder={isL1Operator ? "Ej: Puesto Norte" : "Ej: CASA PAVAS"}
              />
            </div>
            <Button type="button" className="bg-primary text-black font-black uppercase" onClick={() => void loadHistory()} disabled={!selectedStation.trim() || loading}>
              Consultar
            </Button>
          </div>
          {isL1Operator && !stationProfileRegistered ? (
            <p className="text-[10px] uppercase font-black text-amber-300">Este puesto aún no está registrado como puesto operativo L1. El historial sigue visible si existe, pero no debería abrir nuevos turnos.</p>
          ) : null}
          {isL1Operator && stationProfileRegistered && !stationProfileEnabled ? (
            <p className="text-[10px] uppercase font-black text-amber-300">Este puesto está pausado para L1 operativo. Revise el historial, pero no abra nuevos turnos hasta reactivarlo.</p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Turno actual</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activeShift ? (
              <>
                <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3">
                  <p className="text-[10px] uppercase font-black text-cyan-200">Oficial activo</p>
                  <p className="text-lg font-black uppercase text-white">{activeShift.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">{formatDateTime(activeShift.checkInAt)}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Estado</p>
                  <p className="text-sm font-black uppercase text-white">En turno</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Observación</p>
                  <p className="text-sm text-white whitespace-pre-wrap">{activeShift.notes || "Sin observación registrada."}</p>
                </div>
                {!isL1Operator && isDirectorUser ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15"
                    disabled={closingShiftId === activeShift.id}
                    onClick={() => void closeShiftAsDirector({ id: activeShift.id, postName: activeShift.stationPostName || selectedStation, officerName: activeShift.officerName })}
                  >
                    {closingShiftId === activeShift.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <XCircle className="w-4 h-4" />} Cerrar turno manual L4
                  </Button>
                ) : null}
              </>
            ) : latestEntry ? (
              <>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Último turno</p>
                  <p className="text-lg font-black uppercase text-white">{latestEntry.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">{latestEntry.checkOutAt ? formatDateTime(latestEntry.checkOutAt) : "Sin cierre"}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Duración</p>
                  <p className="text-sm font-black uppercase text-white">{formatShiftDuration(latestEntry.checkInAt, latestEntry.checkOutAt) || formatWorkedMinutes(latestEntry.workedMinutes)}</p>
                </div>
              </>
            ) : (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">Sin turnos registrados.</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Turnos</p>
                <p className="text-xl font-black text-white">{history.length}</p>
              </div>
              <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3">
                <p className="text-[10px] uppercase font-black text-amber-100">Con observación</p>
                <p className="text-xl font-black text-white">{notedEntries.length}</p>
              </div>
            </div>
            {latestNote ? (
              <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3 space-y-1">
                <p className="text-[10px] uppercase font-black text-amber-100">Observación reciente</p>
                <p className="text-[11px] uppercase text-white/70">{latestNote.officerName} dejó novedad en su turno.</p>
                <p className="text-sm text-white whitespace-pre-wrap">{latestNote.notes}</p>
              </div>
            ) : null}
            {message ? <p className="text-[10px] uppercase text-amber-300 font-black">{message}</p> : null}
          </CardContent>
        </Card>

        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2"><BookText className="w-4 h-4 text-primary" /> Historial de asistencia</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading ? (
              <div className="h-32 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
            ) : history.length === 0 ? (
              <div className="rounded border border-white/10 bg-black/20 p-3 text-[11px] uppercase text-white/55">Sin marcaciones para este puesto.</div>
            ) : (
              history.map((entry) => (
                <div key={entry.id} className="rounded border border-white/10 bg-black/20 p-4 space-y-2">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-2">
                    <div>
                      <p className="text-[11px] font-black uppercase text-white">{entry.officerName}</p>
                      <p className="text-[10px] uppercase text-white/55">{formatDateTime(entry.checkInAt)}</p>
                    </div>
                    <span className="text-[10px] uppercase font-black text-cyan-300">{entry.isOpen ? "EN TURNO" : "CERRADO"}</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase font-black text-white/50 flex items-center gap-2"><Clock3 className="w-3.5 h-3.5" /> Entrada</p>
                      <p className="text-sm text-white">{entry.checkInAt ? new Date(entry.checkInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Sin dato"}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase font-black text-white/50">Salida</p>
                      <p className="text-sm text-white">{entry.checkOutAt ? new Date(entry.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Turno abierto"}</p>
                    </div>
                    <div className="rounded border border-white/10 bg-black/30 p-3">
                      <p className="text-[10px] uppercase font-black text-white/50">Duración</p>
                      <p className="text-sm text-white">{formatShiftDuration(entry.checkInAt, entry.checkOutAt) || formatWorkedMinutes(entry.workedMinutes)}</p>
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/30 p-3">
                    <p className="text-[10px] uppercase font-black text-white/50">Observaciones del turno</p>
                    <p className="text-sm text-white whitespace-pre-wrap">{entry.notes || "Sin observación reportada."}</p>
                  </div>
                  <p className="text-[10px] uppercase text-white/40">Dispositivo: {entry.createdByDeviceEmail || "Sin dato"}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {!isL1Operator && attendanceSummary?.summary ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
            <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Oficiales medidos</p>
            <p className="text-2xl font-black text-white">{attendanceSummary.summary.officers}</p>
          </Card>
          <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
            <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Turnos completados</p>
            <p className="text-2xl font-black text-white">{attendanceSummary.summary.totalCompletedShifts}</p>
          </Card>
          <Card className="bg-[#0c0c0c]/70 border-white/5 p-4">
            <p className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">Promedio por oficial</p>
            <p className="text-2xl font-black text-white">{formatHoursValue(attendanceSummary.summary.averageWorkedHours)}</p>
          </Card>
        </div>
      ) : null}

      {!isL1Operator && attendanceSummary?.officers?.length ? (
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
              <UserRound className="w-4 h-4 text-primary" /> Horas laboradas por oficial
            </CardTitle>
            <CardDescription className="text-white/60 text-xs">Ranking operativo del último corte de 30 días.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {attendanceSummary.officers.slice(0, 12).map((officer) => (
              <div key={officer.officerUserId} className="rounded border border-white/10 bg-black/20 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <p className="text-[11px] font-black uppercase text-white">{officer.officerName}</p>
                  <p className="text-[10px] uppercase text-white/55">{officer.assigned || "Sin asignación base"}</p>
                  <p className="text-[10px] uppercase text-white/45">Última entrada: {formatDateTime(officer.lastCheckInAt)}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 md:min-w-[280px]">
                  <div className="rounded border border-white/10 bg-black/30 p-3 text-center">
                    <p className="text-[10px] uppercase text-white/45">Horas</p>
                    <p className="text-sm font-black text-white">{formatHoursValue(officer.totalWorkedHours)}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/30 p-3 text-center">
                    <p className="text-[10px] uppercase text-white/45">Días</p>
                    <p className="text-sm font-black text-white">{officer.workedDays}</p>
                  </div>
                  <div className="rounded border border-white/10 bg-black/30 p-3 text-center">
                    <p className="text-[10px] uppercase text-white/45">Abiertos</p>
                    <p className="text-sm font-black text-white">{officer.openShifts}</p>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}