"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { Building2, Clock3, Loader2, LogIn, LogOut, RefreshCcw, UserRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { resolveStationReference } from "@/lib/stations"
import { useSupabase, useUser } from "@/supabase"

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

type ShiftOfficerOption = {
  id: string
  name: string
  email: string
  assigned: string
  status: string
  isAssignedHere: boolean
}

type StationShiftContextValue = {
  enabled: boolean
  stationKey: string
  stationOperationName: string
  stationPostName: string
  stationLabel: string
  activeOfficerName: string
  shiftStartedAt: string | null
  attendanceModeAvailable: boolean
  shiftHistory: ShiftHistoryEntry[]
  openShiftDialog: () => void
  closeShiftDialog: () => void
  updateShift: (next: { stationLabel?: string; activeOfficerName: string }) => void
  clearShift: () => void
}

type StoredShiftState = {
  activeShiftId: string | null
  stationLabel: string
  activeOfficerName: string
  shiftStartedAt: string | null
}

const STORAGE_KEY = "ho_station_shift_v1"

const StationShiftContext = createContext<StationShiftContextValue | undefined>(undefined)

function readStoredShift(): StoredShiftState | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<StoredShiftState>
    const activeShiftId = typeof parsed.activeShiftId === "string" ? parsed.activeShiftId : null
    const stationLabel = String(parsed.stationLabel ?? "").trim()
    const activeOfficerName = String(parsed.activeOfficerName ?? "").trim()
    const shiftStartedAt = typeof parsed.shiftStartedAt === "string" ? parsed.shiftStartedAt : null
    if (!stationLabel && !activeOfficerName) return null
    return { activeShiftId, stationLabel, activeOfficerName, shiftStartedAt }
  } catch {
    return null
  }
}

function formatShiftTime(iso: string | null) {
  if (!iso) return "Sin turno activo"
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "Sin turno activo"
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

function formatWorkedTime(minutes: number) {
  if (!Number.isFinite(minutes) || minutes <= 0) return "0 min"
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours === 0) return `${remainder} min`
  if (remainder === 0) return `${hours} h`
  return `${hours} h ${remainder} min`
}

export function StationShiftProvider({ children }: { children: ReactNode }) {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const isL1Operator = Number(user?.roleLevel ?? 1) <= 1
  const assignedStation = useMemo(() => resolveStationReference({ assigned: user?.assigned }), [user?.assigned])
  const defaultStationLabel = assignedStation.label

  const [shiftState, setShiftState] = useState<StoredShiftState | null>(() => readStoredShift())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftStationLabel, setDraftStationLabel] = useState(() => readStoredShift()?.stationLabel ?? "")
  const [draftOfficerId, setDraftOfficerId] = useState("")
  const [draftNotes, setDraftNotes] = useState("")
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryEntry[]>([])
  const [officerOptions, setOfficerOptions] = useState<ShiftOfficerOption[]>([])
  const [attendanceModeAvailable, setAttendanceModeAvailable] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [isSubmittingShift, setIsSubmittingShift] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)

  const effectiveStation = useMemo(() => resolveStationReference({ assigned: user?.assigned, stationLabel: shiftState?.stationLabel || defaultStationLabel }), [defaultStationLabel, shiftState?.stationLabel, user?.assigned])
  const effectiveStationLabel = effectiveStation.label
  const forceDialogOpen = isL1Operator && !String(shiftState?.activeOfficerName ?? "").trim()
  const selectedOfficer = useMemo(() => officerOptions.find((officer) => officer.id === draftOfficerId) ?? null, [draftOfficerId, officerOptions])
  const activeHistoryEntry = useMemo(() => shiftHistory.find((entry) => entry.isOpen) ?? null, [shiftHistory])

  const persistState = useCallback((next: StoredShiftState | null) => {
    setShiftState(next)
    if (typeof window === "undefined") return
    if (!next) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }, [])

  const updateShift = useCallback((next: { stationLabel?: string; activeOfficerName: string }) => {
    const stationLabel = effectiveStation.postName || defaultStationLabel
    const activeOfficerName = String(next.activeOfficerName ?? "").trim()
    const payload: StoredShiftState = {
      activeShiftId: shiftState?.activeShiftId ?? null,
      stationLabel,
      activeOfficerName,
      shiftStartedAt: new Date().toISOString(),
    }
    persistState(payload)
    setDraftStationLabel(stationLabel)
    setDraftOfficerId("")
    setDialogOpen(false)
  }, [defaultStationLabel, effectiveStation.postName, persistState, shiftState?.activeShiftId])

  const getAuthHeaders = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = String(sessionData.session?.access_token ?? "").trim()
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = String(refreshed.session?.access_token ?? "").trim()
    }

    return {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    }
  }, [supabase])

  const refreshShiftHistory = useCallback(async (stationLabel: string, syncShiftState = false) => {
    if (!isL1Operator) return
    setLoadingHistory(true)
    try {
      const headers = await getAuthHeaders()
      const station = resolveStationReference({ assigned: user?.assigned, stationLabel })
      const response = await fetch(`/api/shifts?stationLabel=${encodeURIComponent(station.label)}&stationPostName=${encodeURIComponent(station.postName)}`, {
        method: "GET",
        headers,
        credentials: "include",
      })
      const data = (await response.json()) as {
        attendanceModeAvailable?: boolean
        history?: ShiftHistoryEntry[]
        activeShift?: ShiftHistoryEntry | null
        officers?: ShiftOfficerOption[]
        message?: string | null
      }
      setAttendanceModeAvailable(Boolean(data.attendanceModeAvailable))
      setShiftHistory(Array.isArray(data.history) ? data.history : [])
      setOfficerOptions(Array.isArray(data.officers) ? data.officers : [])
      setShiftError(data.message ?? null)

      if (syncShiftState && data.attendanceModeAvailable) {
        if (data.activeShift?.id) {
          persistState({
            activeShiftId: data.activeShift.id,
            stationLabel: String(data.activeShift.stationLabel ?? station.label),
            activeOfficerName: String(data.activeShift.officerName ?? "").trim(),
            shiftStartedAt: data.activeShift.checkInAt ?? null,
          })
        } else {
          persistState({
            activeShiftId: null,
            stationLabel: station.label,
            activeOfficerName: "",
            shiftStartedAt: null,
          })
        }
      }
    } catch {
      setShiftError("No se pudo cargar historial del puesto.")
    } finally {
      setLoadingHistory(false)
    }
  }, [getAuthHeaders, isL1Operator, persistState, user?.assigned])

  useEffect(() => {
    if (!isL1Operator || !effectiveStationLabel) return
    void refreshShiftHistory(effectiveStationLabel, true)
  }, [effectiveStationLabel, isL1Operator, refreshShiftHistory])

  const clearShift = useCallback(() => {
    const payload: StoredShiftState = {
      activeShiftId: null,
      stationLabel: shiftState?.stationLabel || defaultStationLabel,
      activeOfficerName: "",
      shiftStartedAt: null,
    }
    persistState(payload)
    setDraftStationLabel(payload.stationLabel)
    setDraftOfficerId("")
    setDraftNotes("")
    setDialogOpen(true)
  }, [defaultStationLabel, persistState, shiftState?.stationLabel])

  const openShiftDialog = useCallback(() => {
    setDraftStationLabel(effectiveStationLabel)
    setDraftOfficerId("")
    setDialogOpen(true)
    void refreshShiftHistory(effectiveStationLabel)
  }, [effectiveStationLabel, refreshShiftHistory])

  const startShift = useCallback(async () => {
    const stationLabel = (draftStationLabel || effectiveStationLabel).trim() || effectiveStationLabel
    if (!draftOfficerId.trim()) {
      setShiftError("Seleccione el oficial que entra al puesto.")
      return
    }

    setIsSubmittingShift(true)
    setShiftError(null)
    try {
      const headers = await getAuthHeaders()
      const station = resolveStationReference({ assigned: user?.assigned, stationLabel: effectiveStation.postName || stationLabel })
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "check_in",
          stationLabel: station.label,
          stationPostName: station.postName,
          officerUserId: draftOfficerId,
          notes: draftNotes,
        }),
      })
      const data = (await response.json()) as {
        error?: string
        activeShift?: ShiftHistoryEntry | null
        history?: ShiftHistoryEntry[]
        attendanceModeAvailable?: boolean
      }
      if (!response.ok) {
        setShiftError(String(data.error ?? "No se pudo registrar la entrada del oficial."))
        return
      }

      persistState({
        activeShiftId: String(data.activeShift?.id ?? "").trim() || null,
        stationLabel: String(data.activeShift?.stationLabel ?? stationLabel),
        activeOfficerName: String(data.activeShift?.officerName ?? "").trim(),
        shiftStartedAt: data.activeShift?.checkInAt ?? null,
      })
      setShiftHistory(Array.isArray(data.history) ? data.history : [])
      setAttendanceModeAvailable(Boolean(data.attendanceModeAvailable))
      setDraftOfficerId("")
      setDraftNotes("")
      setDialogOpen(false)
    } catch {
      setShiftError("No se pudo registrar la entrada del oficial.")
    } finally {
      setIsSubmittingShift(false)
    }
  }, [draftNotes, draftOfficerId, draftStationLabel, effectiveStation.postName, effectiveStationLabel, getAuthHeaders, persistState, user?.assigned])

  const endShift = useCallback(async () => {
    const stationLabel = effectiveStationLabel.trim() || defaultStationLabel
    setIsSubmittingShift(true)
    setShiftError(null)
    try {
      const headers = await getAuthHeaders()
      const response = await fetch("/api/shifts", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({
          action: "check_out",
          stationLabel,
          stationPostName: effectiveStation.postName || stationLabel,
          activeShiftId: shiftState?.activeShiftId ?? null,
          notes: draftNotes,
        }),
      })
      const data = (await response.json()) as {
        error?: string
        history?: ShiftHistoryEntry[]
        attendanceModeAvailable?: boolean
      }
      if (!response.ok) {
        setShiftError(String(data.error ?? "No se pudo registrar la salida del oficial."))
        return
      }

      persistState({
        activeShiftId: null,
        stationLabel,
        activeOfficerName: "",
        shiftStartedAt: null,
      })
      setShiftHistory(Array.isArray(data.history) ? data.history : [])
      setAttendanceModeAvailable(Boolean(data.attendanceModeAvailable))
      setDraftNotes("")
      setDraftOfficerId("")
      setDialogOpen(false)
    } catch {
      setShiftError("No se pudo registrar la salida del oficial.")
    } finally {
      setIsSubmittingShift(false)
    }
  }, [defaultStationLabel, draftNotes, effectiveStation.postName, effectiveStationLabel, getAuthHeaders, persistState, shiftState?.activeShiftId])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(forceDialogOpen ? true : open)
    if (open || forceDialogOpen) {
      void refreshShiftHistory((draftStationLabel || effectiveStationLabel).trim() || effectiveStationLabel)
    }
  }, [draftStationLabel, effectiveStationLabel, forceDialogOpen, refreshShiftHistory])

  const value = useMemo<StationShiftContextValue>(() => ({
    enabled: isL1Operator,
    stationKey: effectiveStation.key,
    stationOperationName: effectiveStation.operationName,
    stationPostName: effectiveStation.postName,
    stationLabel: effectiveStationLabel,
    activeOfficerName: shiftState?.activeOfficerName || "",
    shiftStartedAt: shiftState?.shiftStartedAt ?? null,
    attendanceModeAvailable,
    shiftHistory,
    openShiftDialog,
    closeShiftDialog: () => setDialogOpen(false),
    updateShift,
    clearShift,
  }), [attendanceModeAvailable, clearShift, effectiveStation.key, effectiveStation.operationName, effectiveStation.postName, effectiveStationLabel, isL1Operator, openShiftDialog, shiftHistory, shiftState?.activeOfficerName, shiftState?.shiftStartedAt, updateShift])

  return (
    <StationShiftContext.Provider value={value}>
      {children}

      {isL1Operator ? (
        <Dialog open={dialogOpen || forceDialogOpen} onOpenChange={handleDialogOpenChange}>
          <DialogContent className="bg-black border-white/10 text-white max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm font-black uppercase tracking-wider">Turno del puesto</DialogTitle>
              <DialogDescription className="text-[10px] text-white/60 uppercase">
                L1 solo necesita marcar entrada y salida del oficial asignado al puesto.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3 space-y-2">
                <div className="flex items-center gap-2 text-cyan-100">
                  <Building2 className="w-4 h-4" />
                  <span className="text-[10px] font-black uppercase">Puesto fijo</span>
                </div>
                <p className="text-xs font-black uppercase text-white">{shiftState?.stationLabel || defaultStationLabel}</p>
                <p className="text-[10px] uppercase text-white/55">Última entrada: {formatShiftTime(shiftState?.shiftStartedAt ?? null)}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
                <Input value={effectiveStation.postName || effectiveStationLabel} readOnly className="bg-black/30 border-white/10 text-white/80" />
                <p className="text-[10px] text-white/50 uppercase">El dispositivo queda amarrado al puesto para que el turno sea una sola acción.</p>
              </div>

              {activeHistoryEntry ? (
                <div className="rounded border border-emerald-400/20 bg-emerald-400/10 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-100">
                    <Clock3 className="w-4 h-4" />
                    <span className="text-[10px] font-black uppercase">Oficial en turno</span>
                  </div>
                  <p className="text-lg font-black uppercase text-white">{activeHistoryEntry.officerName}</p>
                  <p className="text-[10px] uppercase text-white/60">Entrada {activeHistoryEntry.checkInAt ? new Date(activeHistoryEntry.checkInAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "Sin hora"}</p>
                  {activeHistoryEntry.notes ? <p className="text-[11px] text-white/80 whitespace-pre-wrap">{activeHistoryEntry.notes}</p> : null}
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Oficial del puesto</Label>
                  <Select value={draftOfficerId} onValueChange={setDraftOfficerId}>
                    <SelectTrigger className="bg-black/30 border-white/10 text-white">
                      <SelectValue placeholder="Seleccione un oficial L1" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-950 border-white/10 text-white">
                      {officerOptions.map((officer) => (
                        <SelectItem key={officer.id} value={officer.id} className="text-white focus:bg-white/10 focus:text-white">
                          {officer.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedOfficer ? (
                    <p className="text-[10px] text-white/50 uppercase">{selectedOfficer.email || "Sin correo"}</p>
                  ) : (
                    <p className="text-[10px] text-white/50 uppercase">Seleccione el oficial asignado a este puesto.</p>
                  )}
                  {!loadingHistory && officerOptions.length === 0 ? <p className="text-[10px] text-amber-300 uppercase">No hay oficiales L1 asignados a este puesto.</p> : null}
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Observaciones del turno</Label>
                <Textarea
                  value={draftNotes}
                  onChange={(event) => setDraftNotes(event.target.value)}
                  className="bg-black/30 border-white/10 text-white min-h-[92px]"
                  placeholder="Observaciones breves del ingreso o salida del oficial"
                />
              </div>

              {shiftError ? <p className="text-[10px] uppercase text-amber-300 font-black">{shiftError}</p> : null}

              <div className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] uppercase font-black text-white/60">Historial reciente del puesto</p>
                  {loadingHistory ? <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-200" /> : null}
                </div>
                {!attendanceModeAvailable ? (
                  <p className="text-[10px] uppercase text-amber-300">Registro persistente pendiente de SQL.</p>
                ) : shiftHistory.length === 0 ? (
                  <p className="text-[10px] uppercase text-white/50">Sin entradas registradas.</p>
                ) : (
                  <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                    {shiftHistory.slice(0, 5).map((entry) => (
                      <div key={entry.id} className="rounded border border-white/10 bg-black/20 p-2">
                        <p className="text-[10px] font-black uppercase text-white">{entry.officerName}</p>
                        <p className="text-[10px] uppercase text-white/55">
                          {entry.checkInAt ? new Date(entry.checkInAt).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "Sin fecha"}
                          {entry.checkOutAt ? ` → ${new Date(entry.checkOutAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " · En turno"}
                        </p>
                        <p className="text-[10px] uppercase text-white/45">Duración: {entry.isOpen ? "Turno abierto" : formatWorkedTime(entry.workedMinutes)}</p>
                        {entry.notes ? <p className="text-[10px] text-amber-100/90 whitespace-pre-wrap">{entry.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => void refreshShiftHistory(effectiveStationLabel, true)}>
                Refrescar
              </Button>
              {activeHistoryEntry ? (
                <Button
                  type="button"
                  className="bg-primary text-black font-black uppercase"
                  disabled={isSubmittingShift}
                  onClick={() => {
                    if (attendanceModeAvailable) {
                      void endShift()
                      return
                    }
                    clearShift()
                  }}
                >
                  {isSubmittingShift ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogOut className="w-4 h-4 mr-2" />}
                  {attendanceModeAvailable ? "Marcar salida" : "Cerrar local"}
                </Button>
              ) : (
                <Button
                  type="button"
                  className="bg-primary text-black font-black uppercase"
                  disabled={!draftOfficerId.trim() || isSubmittingShift}
                  onClick={() => {
                    if (attendanceModeAvailable) {
                      void startShift()
                      return
                    }
                    updateShift({ stationLabel: effectiveStation.postName, activeOfficerName: selectedOfficer?.name ?? "" })
                  }}
                >
                  {isSubmittingShift ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                  {attendanceModeAvailable ? "Marcar entrada" : "Confirmar local"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </StationShiftContext.Provider>
  )
}

export function StationShiftBadge() {
  const context = useStationShift()
  if (!context.enabled) return null

  return (
    <button
      type="button"
      onClick={context.openShiftDialog}
      className="flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-2 md:px-3 py-1.5 text-left hover:bg-cyan-400/15"
    >
      <Building2 className="w-4 h-4 text-cyan-200" />
      <div className="leading-tight hidden sm:block">
        <p className="text-[9px] font-black uppercase tracking-[0.18em] text-cyan-100">{context.stationLabel}</p>
        <p className="text-[10px] uppercase text-white/70 flex items-center gap-1">
          <UserRound className="w-3 h-3" /> {context.activeOfficerName || "Sin turno"}
        </p>
      </div>
      <RefreshCcw className="w-3.5 h-3.5 text-cyan-100/70" />
    </button>
  )
}

export function useStationShift() {
  const value = useContext(StationShiftContext)
  if (!value) {
    return {
      enabled: false,
      stationKey: "",
      stationOperationName: "",
      stationPostName: "",
      stationLabel: "",
      activeOfficerName: "",
      shiftStartedAt: null,
      attendanceModeAvailable: false,
      shiftHistory: [],
      openShiftDialog: () => {},
      closeShiftDialog: () => {},
      updateShift: () => {},
      clearShift: () => {},
    } satisfies StationShiftContextValue
  }
  return value
}