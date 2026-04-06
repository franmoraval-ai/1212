"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { Building2, Clock3, Loader2, LogIn, LogOut, RefreshCcw, UserRound } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { fetchInternalApi } from "@/lib/internal-api"
import { buildStationKey, resolveStationReference } from "@/lib/stations"
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

type StationProfileState = {
  isRegistered: boolean
  isEnabled: boolean
  deviceLabel: string
  notes: string
}

type AuthorizedStationProfile = {
  operationCatalogId: string
  operationName: string
  postName: string
  isEnabled: boolean
  deviceLabel: string | null
  notes: string | null
}

type StationShiftContextValue = {
  enabled: boolean
  stationKey: string
  stationOperationName: string
  stationPostName: string
  stationLabel: string
  stationProfileRegistered: boolean
  stationProfileEnabled: boolean
  stationDeviceLabel: string
  stationProfileNotes: string
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

function normalizeStationProfile(payload: {
  profile?: {
    isEnabled?: boolean
    deviceLabel?: string | null
    notes?: string | null
  } | null
}) {
  return {
    isRegistered: Boolean(payload.profile),
    isEnabled: payload.profile?.isEnabled !== false,
    deviceLabel: String(payload.profile?.deviceLabel ?? "").trim(),
    notes: String(payload.profile?.notes ?? "").trim(),
  } satisfies StationProfileState
}

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

  const [shiftState, setShiftState] = useState<StoredShiftState | null>(() => readStoredShift())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftStationLabel, setDraftStationLabel] = useState(() => readStoredShift()?.stationLabel ?? "")
  const [draftOfficerId, setDraftOfficerId] = useState("")
  const [draftNotes, setDraftNotes] = useState("")
  const [authorizedStations, setAuthorizedStations] = useState<AuthorizedStationProfile[]>([])
  const [shiftHistory, setShiftHistory] = useState<ShiftHistoryEntry[]>([])
  const [officerOptions, setOfficerOptions] = useState<ShiftOfficerOption[]>([])
  const [attendanceModeAvailable, setAttendanceModeAvailable] = useState(false)
  const [stationProfile, setStationProfile] = useState<StationProfileState>({ isRegistered: false, isEnabled: true, deviceLabel: "", notes: "" })
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [isSubmittingShift, setIsSubmittingShift] = useState(false)
  const [shiftError, setShiftError] = useState<string | null>(null)
  const [dismissedBlockedDialog, setDismissedBlockedDialog] = useState(false)

  const bootstrapStationLabel = useMemo(() => {
    if (shiftState?.stationLabel) return shiftState.stationLabel
    if (draftStationLabel.trim()) return draftStationLabel.trim()
    return String(authorizedStations[0]?.postName ?? "").trim()
  }, [authorizedStations, draftStationLabel, shiftState?.stationLabel])
  const selectedAuthorizedStation = useMemo(() => {
    const candidate = bootstrapStationLabel.toLowerCase()
    return authorizedStations.find((station) => String(station.postName ?? "").trim().toLowerCase() === candidate) ?? authorizedStations[0] ?? null
  }, [authorizedStations, bootstrapStationLabel])
  const effectiveStation = useMemo(() => {
    if (selectedAuthorizedStation) {
      const label = shiftState?.stationLabel || selectedAuthorizedStation.postName
      return {
        key: buildStationKey(selectedAuthorizedStation.operationName, selectedAuthorizedStation.postName),
        label,
        operationName: selectedAuthorizedStation.operationName,
        postName: selectedAuthorizedStation.postName,
        assignedScope: "",
      }
    }

    return resolveStationReference({ assigned: user?.assigned, stationLabel: shiftState?.stationLabel || draftStationLabel || "" })
  }, [draftStationLabel, selectedAuthorizedStation, shiftState?.stationLabel, user?.assigned])
  const effectiveStationLabel = effectiveStation.label
  const forceDialogOpen = isL1Operator && !String(shiftState?.activeOfficerName ?? "").trim()
  const selectedOfficer = useMemo(() => officerOptions.find((officer) => officer.id === draftOfficerId) ?? null, [draftOfficerId, officerOptions])
  const activeHistoryEntry = useMemo(() => shiftHistory.find((entry) => entry.isOpen) ?? null, [shiftHistory])
  const stationProfileMessage = useMemo(() => {
    if (!stationProfile.isRegistered) return "Este puesto todavía no está registrado en L1 operativo. Pídalo en Centro Operativo."
    if (!stationProfile.isEnabled) return "Este puesto está pausado para L1 operativo. Reactívelo en Centro Operativo."
    return null
  }, [stationProfile.isEnabled, stationProfile.isRegistered])
  const hasNoAuthorizedStations = !loadingHistory && authorizedStations.length === 0
  const hasNoAssignableOfficers = !loadingHistory && !activeHistoryEntry && authorizedStations.length > 0 && officerOptions.length === 0
  const hasBlockingIssue = Boolean(stationProfileMessage) || hasNoAuthorizedStations || hasNoAssignableOfficers
  const shouldKeepDialogOpen = dialogOpen || (forceDialogOpen && !dismissedBlockedDialog)

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
    const stationLabel = String(next.stationLabel ?? effectiveStation.postName ?? effectiveStationLabel).trim()
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
  }, [effectiveStation.postName, effectiveStationLabel, persistState, shiftState?.activeShiftId])

  const refreshAuthorizedStations = useCallback(async () => {
    if (!isL1Operator) return
    try {
      const response = await fetchInternalApi(supabase, "/api/station-profiles?authorized=1", {
        method: "GET",
      })
      const data = (await response.json()) as {
        error?: string
        profiles?: AuthorizedStationProfile[]
      }

      if (!response.ok) {
        setAuthorizedStations([])
        setShiftError((current) => current ?? String(data.error ?? "No se pudieron cargar los puestos autorizados del oficial."))
        return
      }

      const profiles = Array.isArray(data.profiles) ? data.profiles : []
      setAuthorizedStations(profiles)
      const storedStationLabel = String(shiftState?.stationLabel ?? "").trim().toLowerCase()
      const hasStoredAuthorizedStation = storedStationLabel.length > 0 && profiles.some((profile) => String(profile.postName ?? "").trim().toLowerCase() === storedStationLabel)

      if ((storedStationLabel.length === 0 || !hasStoredAuthorizedStation) && profiles[0]?.postName) {
        persistState({
          activeShiftId: null,
          stationLabel: String(profiles[0].postName ?? "").trim(),
          activeOfficerName: "",
          shiftStartedAt: null,
        })
        setDraftStationLabel(String(profiles[0].postName ?? "").trim())
      } else if (profiles.length === 0 && storedStationLabel.length > 0) {
        persistState({
          activeShiftId: null,
          stationLabel: "",
          activeOfficerName: "",
          shiftStartedAt: null,
        })
        setDraftStationLabel("")
      }
    } catch {
      setAuthorizedStations([])
    }
  }, [isL1Operator, persistState, shiftState?.stationLabel, supabase])

  const refreshStationProfile = useCallback(async () => {
    if (!isL1Operator) return
    if (!effectiveStationLabel.trim()) return
    try {
      const params = new URLSearchParams({
        current: "1",
        stationLabel: effectiveStationLabel,
        stationPostName: effectiveStation.postName || effectiveStationLabel,
      })
      const response = await fetchInternalApi(supabase, `/api/station-profiles?${params.toString()}`, {
        method: "GET",
      })
      const data = (await response.json()) as {
        error?: string
        profile?: {
          isEnabled?: boolean
          deviceLabel?: string | null
          notes?: string | null
        } | null
      }

      if (!response.ok) {
        setStationProfile({ isRegistered: false, isEnabled: true, deviceLabel: "", notes: "" })
        setShiftError((current) => current ?? String(data.error ?? "No se pudo validar el registro operativo del puesto."))
        return
      }

      setStationProfile(normalizeStationProfile(data))
    } catch {
      setStationProfile({ isRegistered: false, isEnabled: true, deviceLabel: "", notes: "" })
    }
  }, [effectiveStation.postName, effectiveStationLabel, isL1Operator, supabase])

  const refreshShiftHistory = useCallback(async (stationLabel: string, syncShiftState = false) => {
    if (!isL1Operator) return
    setLoadingHistory(true)
    try {
      const station = resolveStationReference({ assigned: user?.assigned, stationLabel })
      const response = await fetchInternalApi(supabase, `/api/shifts?stationLabel=${encodeURIComponent(station.label)}&stationPostName=${encodeURIComponent(station.postName)}`, {
        method: "GET",
      })
      const data = (await response.json()) as {
        attendanceModeAvailable?: boolean
        history?: ShiftHistoryEntry[]
        activeShift?: ShiftHistoryEntry | null
        officers?: ShiftOfficerOption[]
        message?: string | null
        error?: string | null
      }
      if (!response.ok) {
        setAttendanceModeAvailable(false)
        setShiftHistory([])
        setOfficerOptions([])
        setShiftError(String(data.error ?? data.message ?? "No se pudo cargar historial del puesto."))
        return
      }

      setAttendanceModeAvailable(Boolean(data.attendanceModeAvailable))
      setShiftHistory(Array.isArray(data.history) ? data.history : [])
      setOfficerOptions(Array.isArray(data.officers) ? data.officers : [])
      setShiftError(data.message ?? null)

      if (syncShiftState && data.attendanceModeAvailable) {
        if (data.activeShift?.id) {
          persistState({
            activeShiftId: data.activeShift.id,
            stationLabel: station.postName || station.label,
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
  }, [isL1Operator, persistState, supabase, user?.assigned])

  useEffect(() => {
    if (!isL1Operator) return
    void refreshAuthorizedStations()
  }, [isL1Operator, refreshAuthorizedStations])

  useEffect(() => {
    if (!isL1Operator || !effectiveStationLabel) return
    void refreshShiftHistory(effectiveStationLabel, true)
  }, [effectiveStationLabel, isL1Operator, refreshShiftHistory])

  useEffect(() => {
    if (!isL1Operator) return
    void refreshStationProfile()
  }, [isL1Operator, refreshStationProfile])

  useEffect(() => {
    if (!dismissedBlockedDialog) return
    if (hasBlockingIssue) return
    setDismissedBlockedDialog(false)
  }, [dismissedBlockedDialog, hasBlockingIssue])

  const closeShiftDialog = useCallback(() => {
    setDialogOpen(false)
    if (forceDialogOpen && hasBlockingIssue) {
      setDismissedBlockedDialog(true)
    }
  }, [forceDialogOpen, hasBlockingIssue])

  const clearShift = useCallback(() => {
    const payload: StoredShiftState = {
      activeShiftId: null,
      stationLabel: shiftState?.stationLabel || effectiveStation.postName || effectiveStationLabel,
      activeOfficerName: "",
      shiftStartedAt: null,
    }
    persistState(payload)
    setDraftStationLabel(payload.stationLabel)
    setDraftOfficerId("")
    setDraftNotes("")
    setDialogOpen(true)
  }, [effectiveStation.postName, effectiveStationLabel, persistState, shiftState?.stationLabel])

  const openShiftDialog = useCallback(() => {
    setDismissedBlockedDialog(false)
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
      const station = resolveStationReference({ assigned: user?.assigned, stationLabel: effectiveStation.postName || stationLabel })
      const response = await fetchInternalApi(supabase, "/api/shifts", {
        method: "POST",
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
        stationProfile?: {
          isEnabled?: boolean
          deviceLabel?: string | null
          notes?: string | null
        } | null
      }
      if (!response.ok) {
        if (data.stationProfile !== undefined) {
          setStationProfile(normalizeStationProfile({ profile: data.stationProfile }))
        }
        setShiftError(String(data.error ?? "No se pudo registrar la entrada del oficial."))
        return
      }

      if (data.stationProfile !== undefined) {
        setStationProfile(normalizeStationProfile({ profile: data.stationProfile }))
      }
      persistState({
        activeShiftId: String(data.activeShift?.id ?? "").trim() || null,
        stationLabel: station.postName || stationLabel,
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
  }, [draftNotes, draftOfficerId, draftStationLabel, effectiveStation.postName, effectiveStationLabel, persistState, supabase, user?.assigned])

  const endShift = useCallback(async () => {
    const stationLabel = effectiveStationLabel.trim() || effectiveStation.postName || draftStationLabel.trim()
    setIsSubmittingShift(true)
    setShiftError(null)
    try {
      const response = await fetchInternalApi(supabase, "/api/shifts", {
        method: "POST",
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
        stationProfile?: {
          isEnabled?: boolean
          deviceLabel?: string | null
          notes?: string | null
        } | null
      }
      if (!response.ok) {
        if (data.stationProfile !== undefined) {
          setStationProfile(normalizeStationProfile({ profile: data.stationProfile }))
        }
        setShiftError(String(data.error ?? "No se pudo registrar la salida del oficial."))
        return
      }

      if (data.stationProfile !== undefined) {
        setStationProfile(normalizeStationProfile({ profile: data.stationProfile }))
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
  }, [draftNotes, draftStationLabel, effectiveStation.postName, effectiveStationLabel, persistState, shiftState?.activeShiftId, supabase])

  const handleDialogOpenChange = useCallback((open: boolean) => {
    if (open) {
      setDismissedBlockedDialog(false)
      setDialogOpen(true)
    } else {
      closeShiftDialog()
    }
    if (open || (forceDialogOpen && !dismissedBlockedDialog)) {
      void refreshShiftHistory((draftStationLabel || effectiveStationLabel).trim() || effectiveStationLabel)
    }
  }, [closeShiftDialog, dismissedBlockedDialog, draftStationLabel, effectiveStationLabel, forceDialogOpen, refreshShiftHistory])

  const value = useMemo<StationShiftContextValue>(() => ({
    enabled: isL1Operator,
    stationKey: effectiveStation.key,
    stationOperationName: effectiveStation.operationName,
    stationPostName: effectiveStation.postName,
    stationLabel: effectiveStationLabel,
    stationProfileRegistered: stationProfile.isRegistered,
    stationProfileEnabled: stationProfile.isEnabled,
    stationDeviceLabel: stationProfile.deviceLabel,
    stationProfileNotes: stationProfile.notes,
    activeOfficerName: shiftState?.activeOfficerName || "",
    shiftStartedAt: shiftState?.shiftStartedAt ?? null,
    attendanceModeAvailable,
    shiftHistory,
    openShiftDialog,
    closeShiftDialog,
    updateShift,
    clearShift,
  }), [attendanceModeAvailable, clearShift, closeShiftDialog, effectiveStation.key, effectiveStation.operationName, effectiveStation.postName, effectiveStationLabel, isL1Operator, openShiftDialog, shiftHistory, shiftState?.activeOfficerName, shiftState?.shiftStartedAt, stationProfile.deviceLabel, stationProfile.isEnabled, stationProfile.isRegistered, stationProfile.notes, updateShift])

  return (
    <StationShiftContext.Provider value={value}>
      {children}

      {isL1Operator ? (
        <Dialog open={shouldKeepDialogOpen} onOpenChange={handleDialogOpenChange}>
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
                <p className="text-xs font-black uppercase text-white">{shiftState?.stationLabel || effectiveStation.postName || effectiveStationLabel || "Sin puesto operativo"}</p>
                <p className="text-[10px] uppercase text-white/55">Última entrada: {formatShiftTime(shiftState?.shiftStartedAt ?? null)}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
                {authorizedStations.length > 1 && !activeHistoryEntry ? (
                  <Select
                    value={draftStationLabel || effectiveStation.postName || effectiveStationLabel}
                    onValueChange={(value) => {
                      persistState({
                        activeShiftId: null,
                        stationLabel: value,
                        activeOfficerName: "",
                        shiftStartedAt: null,
                      })
                      setDraftStationLabel(value)
                      void refreshShiftHistory(value)
                    }}
                  >
                    <SelectTrigger className="bg-black/30 border-white/10 text-white">
                      <SelectValue placeholder="Seleccione el puesto operativo" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-950 border-white/10 text-white">
                      {authorizedStations.map((station) => (
                        <SelectItem key={station.operationCatalogId} value={station.postName} className="text-white focus:bg-white/10 focus:text-white">
                          {station.operationName} · {station.postName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={effectiveStation.postName || effectiveStationLabel} readOnly className="bg-black/30 border-white/10 text-white/80" />
                )}
                <p className="text-[10px] text-white/50 uppercase">El dispositivo queda amarrado al puesto para que el turno sea una sola acción.</p>
                {stationProfile.deviceLabel ? <p className="text-[10px] text-cyan-200 uppercase">Dispositivo registrado: {stationProfile.deviceLabel}</p> : null}
                {stationProfile.notes ? <p className="text-[10px] text-white/55">{stationProfile.notes}</p> : null}
                {stationProfileMessage ? <p className="text-[10px] uppercase text-amber-300 font-black">{activeHistoryEntry ? `${stationProfileMessage} Puede cerrar el turno abierto, pero no iniciar uno nuevo.` : stationProfileMessage}</p> : null}
                {hasNoAuthorizedStations ? <p className="text-[10px] uppercase text-amber-300 font-black">Este oficial no tiene puestos autorizados activos.</p> : null}
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
                  {hasNoAssignableOfficers ? <p className="text-[10px] text-amber-300 uppercase">No hay oficiales L1 asignados a este puesto.</p> : null}
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
              {hasBlockingIssue ? (
                <Button type="button" variant="ghost" className="text-white/70 hover:bg-white/10 hover:text-white font-black uppercase" onClick={closeShiftDialog}>
                  Cerrar panel
                </Button>
              ) : null}
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
                  disabled={!draftOfficerId.trim() || isSubmittingShift || Boolean(stationProfileMessage)}
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
      stationProfileRegistered: false,
      stationProfileEnabled: false,
      stationDeviceLabel: "",
      stationProfileNotes: "",
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