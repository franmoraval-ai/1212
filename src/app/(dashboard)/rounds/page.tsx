"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Image from "next/image"
import Link from "next/link"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"

import { useStationShift } from "@/components/layout/station-shift-provider"
import { useRoundBulletinDraft } from "@/hooks/use-round-bulletin-draft"
import { useRoundsContext } from "@/hooks/use-rounds-context"
import { useRoundSessionController } from "@/hooks/use-round-session-controller"
import { useSupabase, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { useQrScanner } from "@/hooks/use-qr-scanner"
import { useQueuedOfflineTableRows } from "@/hooks/use-queued-offline-table-rows"
import { extractNfcToken } from "@/lib/nfc"
import { getQueuedOfflineRoundSessionOperations, OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, type QueuedOfflineRoundSessionOperation } from "@/lib/offline-round-session-ops"
import { fetchInternalApi } from "@/lib/internal-api"
import { nowIso, toSnakeCaseKeys } from "@/lib/supabase-db"
import { downloadDataUrlAsFile, openDataUrlInNewTab, optimizeImageFileToDataUrl } from "@/lib/image-utils"
import { AlertTriangle, CheckCircle2, Circle, ClipboardCheck, Download, FileDown, FileSpreadsheet, Loader2, Plus, QrCode, ScanLine, Camera, Trash2, WifiOff, X } from "lucide-react"
import { useSearchParams } from "next/navigation"
import {
  type RoundCheckpoint, type RoundRow, type RoundReportRow, type RoundSessionRow,
  type CheckpointState, type ScanEvent, type GpsPoint, type GpxWaypoint,
  type RoundAlertSummary, type RoundSecurityConfig, type RoundSecurityConfigRow,
  type BulletinContext, type ApplyScanResult,
  MAX_ROUND_PHOTOS,
  normalizeRoundQr, normalizeScanToken, splitCheckpointCodeInput, joinCheckpointCodeInput,
  createRoundReportId, isRoundReportsMissingTableError, toInputDateLocal,
  haversineDistanceMeters, formatDurationLabel, getFrequencyMinutes,
  normalizeRoundCheckpoints, buildTrackSvgPath, loadRoundSecurityConfig,
  getTrackFromUnknownLogs, getReportTrack, getRoundCheckpointWaypoints,
  buildGpxXml, computeRoundAlerts, getStoredAlertMessages,
  getDateFromUnknown, getReportCreatedDate, getReportStartedDate, getReportEndedDate,
  getRoundSessionStartedDate, getRoundSessionLastScanDate,
  getRoundSessionRoundId, getRoundSessionRoundName, getRoundSessionPostName,
  getRoundSessionOfficerName, getRoundSessionProgressLabel,
  getReportRoundName, getReportRoundId, getReportPostName, getReportOfficerId,
  getReportOfficerName, getReportSupervisorName, getReportProgressLabel,
  getRoundReportCode, classifyOfflineSyncCause, formatOfflineSessionKinds,
  normalizeOfflineError, formatRoundExportDateTime, formatRoundGpsPoint,
  formatRoundBooleanLabel, getRoundCompletionRateLabel,
  getRoundLogDetails, getRoundLogPhotos, buildRoundPhotoFileName,
} from "./round-helpers"

import {
  QrScannerDialog, CheckpointCodeEditorDialog, QuickIncidentDialog,
  HistoryTrackDialog, HistoryDetailDialog, HistoryEditDialog,
  RoundEditDialog, AiSummaryDialog,
} from "./round-dialogs"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)

export default function RoundBulletinPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { enabled: stationModeEnabled, stationLabel, stationPostName, stationOperationName, activeOfficerName, openShiftDialog } = useStationShift()
  const { toast } = useToast()
  const searchParams = useSearchParams()
  const prefillRoundId = String(searchParams.get("roundId") ?? "").trim()

  const [activeRoundId, setActiveRoundId] = useState<string>(prefillRoundId)
  const [notes, setNotes] = useState("")
  const [startedAt, setStartedAt] = useState<string | null>(null)
  const [bulletinContext, setBulletinContext] = useState<BulletinContext | null>(null)
  const [checkpointState, setCheckpointState] = useState<CheckpointState[]>([])
  const [scanEvents, setScanEvents] = useState<ScanEvent[]>([])
  const [photos, setPhotos] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [preRoundCondition, setPreRoundCondition] = useState("NORMAL")
  const [preRoundNotes, setPreRoundNotes] = useState("")
  const [checkDoorsClosed, setCheckDoorsClosed] = useState(true)
  const [checkLightsOk, setCheckLightsOk] = useState(true)
  const [checkPerimeterOk, setCheckPerimeterOk] = useState(true)
  const [checkNoStrangers, setCheckNoStrangers] = useState(true)
  const [pendingStartByQr, setPendingStartByQr] = useState(false)
  const [startQrValidated, setStartQrValidated] = useState(false)
  const [gpsTrack, setGpsTrack] = useState<GpsPoint[]>([])
  const [distanceMeters, setDistanceMeters] = useState(0)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [gpsError, setGpsError] = useState<string | null>(null)
  const [historyDateFromFilter, setHistoryDateFromFilter] = useState("")
  const [historyDateToFilter, setHistoryDateToFilter] = useState("")
  const [historyHourFilter, setHistoryHourFilter] = useState("")
  const [historyOperationFilter, setHistoryOperationFilter] = useState("")
  const [historyLocationFilter, setHistoryLocationFilter] = useState("")
  const [historySupervisorFilter, setHistorySupervisorFilter] = useState("")
  const [historyTrackOpen, setHistoryTrackOpen] = useState(false)
  const [historyTrackReport, setHistoryTrackReport] = useState<RoundReportRow | null>(null)
  const [historyDetailOpen, setHistoryDetailOpen] = useState(false)
  const [historyDetailReport, setHistoryDetailReport] = useState<RoundReportRow | null>(null)
  const [historyEditOpen, setHistoryEditOpen] = useState(false)
  const [historyEditId, setHistoryEditId] = useState("")
  const [historyEditRoundName, setHistoryEditRoundName] = useState("")
  const [historyEditPostName, setHistoryEditPostName] = useState("")
  const [historyEditOfficerName, setHistoryEditOfficerName] = useState("")
  const [historyEditSupervisorName, setHistoryEditSupervisorName] = useState("")
  const [historyEditStatus, setHistoryEditStatus] = useState("COMPLETA")
  const [historyEditNotes, setHistoryEditNotes] = useState("")
  const [isSavingHistoryEdit, setIsSavingHistoryEdit] = useState(false)
  const [deletingHistoryReportId, setDeletingHistoryReportId] = useState("")
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false)
  const [aiSummaryLoadingId, setAiSummaryLoadingId] = useState("")
  const [aiSummaryReportCode, setAiSummaryReportCode] = useState("")
  const [aiSummaryText, setAiSummaryText] = useState("")
  const [roundEditOpen, setRoundEditOpen] = useState(false)
  const [roundEditId, setRoundEditId] = useState("")
  const [roundEditName, setRoundEditName] = useState("")
  const [roundEditPost, setRoundEditPost] = useState("")
  const [roundEditStatus, setRoundEditStatus] = useState("Activa")
  const [roundEditFrequency, setRoundEditFrequency] = useState("Cada 30 minutos")
  const [roundEditInstructions, setRoundEditInstructions] = useState("")
  const [roundEditCheckpoints, setRoundEditCheckpoints] = useState<RoundCheckpoint[]>([])
  const [roundCheckpointOverrides, setRoundCheckpointOverrides] = useState<Record<string, RoundCheckpoint[]>>({})
  const [isSavingRoundEdit, setIsSavingRoundEdit] = useState(false)
  const [deletingRoundId, setDeletingRoundId] = useState("")
  const [geofenceRadiusMeters, setGeofenceRadiusMeters] = useState(() => loadRoundSecurityConfig().geofenceRadiusMeters)
  const [noScanGapMinutes, setNoScanGapMinutes] = useState(() => loadRoundSecurityConfig().noScanGapMinutes)
  const [maxJumpMeters, setMaxJumpMeters] = useState(() => loadRoundSecurityConfig().maxJumpMeters)
  const [isSavingSecurityConfig, setIsSavingSecurityConfig] = useState(false)
  const [quickIncidentOpen, setQuickIncidentOpen] = useState(false)
  const [quickIncidentType, setQuickIncidentType] = useState("")
  const [quickIncidentDescription, setQuickIncidentDescription] = useState("")
  const [savingQuickIncident, setSavingQuickIncident] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrInput, setQrInput] = useState("")
  const [checkpointCodeEditOpen, setCheckpointCodeEditOpen] = useState(false)
  const [checkpointCodeEditId, setCheckpointCodeEditId] = useState("")
  const [checkpointCodeEditName, setCheckpointCodeEditName] = useState("")
  const [checkpointCodeEditQrText, setCheckpointCodeEditQrText] = useState("")
  const [checkpointCodeEditNfcText, setCheckpointCodeEditNfcText] = useState("")
  const [checkpointCodeEditSaving, setCheckpointCodeEditSaving] = useState(false)
  const [isNfcScanning, setIsNfcScanning] = useState(false)
  const [nfcSupported] = useState(() => typeof window !== "undefined" && "NDEFReader" in window)
  const [isStandalonePwa, setIsStandalonePwa] = useState(false)
  const [queuedRoundSessionOps, setQueuedRoundSessionOps] = useState<QueuedOfflineRoundSessionOperation[]>([])
  const nfcAbortRef = useRef<AbortController | null>(null)
  const gpsWatchIdRef = useRef<number | null>(null)
  const latestGpsPointRef = useRef<GpsPoint | null>(null)
  const activeRoundRef = useRef<RoundRow | null>(null)
  const checkpointStateRef = useRef<CheckpointState[]>([])
  const startedAtRef = useRef<string | null>(null)
  const pendingStartByQrRef = useRef(false)

  const {
    rounds: roundsData,
    reports: reportsData,
    securityConfigRows,
    roundSessions: roundSessionsData,
    authorizedOperations: authorizedOpsData,
    isLoading: roundsContextLoading,
    error: roundsContextError,
    reload,
  } = useRoundsContext({ includeReports: true, includeSecurityConfig: true, includeSessions: true })

  const roundsLoading = roundsContextLoading
  const reportsLoading = roundsContextLoading
  const securityConfigError = roundsContextError

  const rounds = useMemo(() => (roundsData ?? []) as RoundRow[], [roundsData])
  const reports = useMemo(() => (reportsData ?? []) as RoundReportRow[], [reportsData])
  const roundSessions = useMemo(() => (roundSessionsData ?? []) as RoundSessionRow[], [roundSessionsData])
  const mapQueuedRoundReports = useCallback((items: Array<{ id: string; action: string; payload: Record<string, unknown> | Record<string, unknown>[] | undefined; createdAt: string; lastError?: string; attempts?: number }>) => items
    .filter((item) => item.action === "insert" && item.payload && !Array.isArray(item.payload))
    .map((item) => {
      const payload = item.payload as Record<string, unknown>
      return {
        id: String(payload.id ?? item.id),
        started_at: String(payload.started_at ?? "").trim() || undefined,
        ended_at: String(payload.ended_at ?? "").trim() || undefined,
        round_id: String(payload.round_id ?? ""),
        round_name: String(payload.round_name ?? ""),
        post_name: String(payload.post_name ?? ""),
        officer_id: String(payload.officer_id ?? ""),
        officer_name: String(payload.officer_name ?? ""),
        supervisor_name: String(payload.supervisor_name ?? ""),
        status: String(payload.status ?? "PENDIENTE_SYNC"),
        notes: typeof payload.notes === "string" ? payload.notes : null,
        checkpoints_total: Number(payload.checkpoints_total ?? 0),
        checkpoints_completed: Number(payload.checkpoints_completed ?? 0),
        created_at: String(payload.created_at ?? item.createdAt),
        checkpoint_logs: payload.checkpoint_logs,
        localOnly: true,
        offlineSyncCause: classifyOfflineSyncCause(item.lastError),
        offlineLastError: String(item.lastError ?? "").trim() || null,
        offlineAttempts: Number(item.attempts ?? 0),
      }
    }), [])
  const queuedRoundReports = useQueuedOfflineTableRows<RoundReportRow>({
    table: "round_reports",
    refreshIntervalMs: 20000,
    mapRows: mapQueuedRoundReports,
  })
  const roleLevel = Number(user?.roleLevel ?? 1)
  const isL1Operator = roleLevel <= 1
  const actingOfficerName = useMemo(
    () => (stationModeEnabled ? String(activeOfficerName).trim() : "") || String(user?.firstName ?? user?.email ?? "").trim() || "OPERADOR",
    [activeOfficerName, stationModeEnabled, user?.email, user?.firstName]
  )
  const canGenerateAiSummary = roleLevel >= 3
  const canEditFraudConfig = (user?.roleLevel ?? 1) >= 4
  const canManualCheckpointValidation = (user?.roleLevel ?? 1) >= 4
  const canEditRoundReports = (user?.roleLevel ?? 1) >= 4
  const canManageRoundDefinitions = (user?.roleLevel ?? 1) >= 4

  const roundsWithCheckpointOverrides = useMemo(
    () => rounds.map((round) => {
      const override = roundCheckpointOverrides[String(round.id ?? "").trim()]
      return override ? { ...round, checkpoints: override } : round
    }),
    [roundCheckpointOverrides, rounds]
  )

  useEffect(() => {
    if (typeof window === "undefined") return

    const refreshQueuedRoundSessionOps = () => {
      setQueuedRoundSessionOps(getQueuedOfflineRoundSessionOperations())
    }

    refreshQueuedRoundSessionOps()
    window.addEventListener("storage", refreshQueuedRoundSessionOps)
    window.addEventListener(OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, refreshQueuedRoundSessionOps)
    const timer = window.setInterval(refreshQueuedRoundSessionOps, 60000)

    return () => {
      window.removeEventListener("storage", refreshQueuedRoundSessionOps)
      window.removeEventListener(OFFLINE_ROUND_SESSION_OPS_CHANGED_EVENT, refreshQueuedRoundSessionOps)
      window.clearInterval(timer)
    }
  }, [])

  const authorizedOperations = useMemo(
    () => (Array.isArray(authorizedOpsData) ? authorizedOpsData : []) as { operationName: string; clientName: string }[],
    [authorizedOpsData]
  )

  const scopedReports = useMemo(() => {
    // L4 sees all reports
    if (roleLevel >= 4) return reports

    const uid = String(user?.uid ?? "").trim().toLowerCase()
    const email = String(user?.email ?? "").trim().toLowerCase()
    const firstName = String(user?.firstName ?? "").trim().toLowerCase()
    const emailAlias = email.includes("@") ? email.split("@")[0] : email
    const ownerTokens = new Set([uid, email].filter(Boolean))

    const belongsToCurrentUser = (report: RoundReportRow) => {
      const officerId = getReportOfficerId(report).trim().toLowerCase()
      const officerName = getReportOfficerName(report).trim().toLowerCase()
      return (
        (!!officerId && ownerTokens.has(officerId)) ||
        (!!officerName && ((!!firstName && officerName.includes(firstName)) || (!!emailAlias && officerName.includes(emailAlias))))
      )
    }

    const belongsToAssignedScope = (report: RoundReportRow) => {
      if (authorizedOperations.length === 0) return false
      const postName = getReportPostName(report).trim().toLowerCase()
      const roundName = getReportRoundName(report).trim().toLowerCase()
      return authorizedOperations.some((op) => {
        const opName = op.operationName.toLowerCase()
        const clientName = op.clientName.toLowerCase()
        return (
          (!!clientName && postName.includes(clientName)) ||
          (!!opName && (postName.includes(opName) || roundName.includes(opName)))
        )
      })
    }

    // L3: own reports + authorized operations (catalog)
    if (roleLevel >= 3) {
      return reports.filter((report) => belongsToCurrentUser(report) || belongsToAssignedScope(report))
    }

    // L2: own reports + authorized operations
    if (roleLevel >= 2) {
      return reports.filter((report) => belongsToCurrentUser(report) || belongsToAssignedScope(report))
    }

    // L1: own reports only
    return reports.filter((report) => belongsToCurrentUser(report))
  }, [authorizedOperations, reports, roleLevel, user])

  const activeRoundSessions = useMemo(() => {
    if (roleLevel < 3) return [] as RoundSessionRow[]

    return roundSessions
      .filter((session) => String(session.status ?? "").trim().toLowerCase() === "in_progress")
      .sort((left, right) => {
        const leftAt = getRoundSessionStartedDate(left)?.getTime() ?? 0
        const rightAt = getRoundSessionStartedDate(right)?.getTime() ?? 0
        return rightAt - leftAt
      })
  }, [roleLevel, roundSessions])

  const queuedRoundSessionSummary = useMemo(() => {
    const counts = { start: 0, event: 0, finish: 0 }
    let lastError = ""
    let lastCreatedAt = 0

    for (const item of queuedRoundSessionOps) {
      counts[item.kind] += 1
      const createdAt = new Date(item.createdAt).getTime()
      if (createdAt >= lastCreatedAt) {
        lastCreatedAt = createdAt
        lastError = String(item.lastError ?? "").trim()
      }
    }

    return {
      total: queuedRoundSessionOps.length,
      counts,
      lastError: lastError || null,
    }
  }, [queuedRoundSessionOps])

  const queuedRoundSessionByReportId = useMemo(() => {
    const byReportId = new Map<string, { kinds: Set<string>; lastError: string | null }>()

    for (const item of queuedRoundSessionOps) {
      const payload = item.payload as { reportId?: string | null }
      const reportId = String(payload.reportId ?? "").trim()
      if (!reportId) continue

      const existing = byReportId.get(reportId) ?? { kinds: new Set<string>(), lastError: null }
      existing.kinds.add(item.kind)
      const itemError = String(item.lastError ?? "").trim()
      if (itemError) existing.lastError = itemError
      byReportId.set(reportId, existing)
    }

    return byReportId
  }, [queuedRoundSessionOps])

  const effectiveScopedReports = useMemo(() => {
    const byId = new Map<string, RoundReportRow>()

    for (const report of scopedReports) {
      byId.set(String(report.id), report)
    }

    for (const report of queuedRoundReports) {
      const sessionDiagnostic = queuedRoundSessionByReportId.get(String(report.id))
      byId.set(String(report.id), {
        ...report,
        offlineSessionKinds: sessionDiagnostic ? Array.from(sessionDiagnostic.kinds) : [],
        offlineSessionLastError: sessionDiagnostic?.lastError ?? null,
      })
    }

    return Array.from(byId.values()).sort((left, right) => {
      const leftAt = getReportCreatedDate(left)?.getTime() ?? 0
      const rightAt = getReportCreatedDate(right)?.getTime() ?? 0
      return rightAt - leftAt
    })
  }, [queuedRoundReports, queuedRoundSessionByReportId, scopedReports])

  const latestReportByRound = useMemo(() => {
    const map = new Map<string, Date>()
    const effectiveReports = effectiveScopedReports
    for (const report of effectiveReports) {
      const roundId = getReportRoundId(report)
      const roundName = getReportRoundName(report)
      const createdAt = getReportCreatedDate(report)
      if (!createdAt || Number.isNaN(createdAt.getTime())) continue
      const keys = [roundName, roundId].filter(Boolean)
      for (const key of keys) {
        const previous = map.get(key)
        if (!previous || createdAt > previous) {
          map.set(key, createdAt)
        }
      }
    }
    return map
  }, [effectiveScopedReports])

  const localDraftSecurityConfig = useMemo<RoundSecurityConfig>(() => ({
    geofenceRadiusMeters,
    noScanGapMinutes,
    maxJumpMeters,
  }), [geofenceRadiusMeters, noScanGapMinutes, maxJumpMeters])

  const serverSecurityConfig = useMemo<RoundSecurityConfig | null>(() => {
    const row = (securityConfigRows ?? [])[0]
    if (!row) return null
    const geofence = Number(row.geofenceRadiusMeters)
    const noScan = Number(row.noScanGapMinutes)
    const jump = Number(row.maxJumpMeters)
    if (!Number.isFinite(geofence) || !Number.isFinite(noScan) || !Number.isFinite(jump)) return null
    return {
      geofenceRadiusMeters: Math.max(20, Math.min(300, geofence)),
      noScanGapMinutes: Math.max(3, Math.min(30, noScan)),
      maxJumpMeters: Math.max(60, Math.min(500, jump)),
    }
  }, [securityConfigRows])

  const securityConfig = useMemo<RoundSecurityConfig>(() => {
    if (canEditFraudConfig) return localDraftSecurityConfig
    return serverSecurityConfig ?? localDraftSecurityConfig
  }, [canEditFraudConfig, localDraftSecurityConfig, serverSecurityConfig])

  const activeRound = useMemo(
    () => roundsWithCheckpointOverrides.find((r) => String(r.id) === activeRoundId) ?? null,
    [roundsWithCheckpointOverrides, activeRoundId]
  )

  const {
    activeSessionIdRef,
    sendRoundEventForSession,
    startRoundSession,
    finishRoundSession,
    setSessionId,
    clearSessionId,
  } = useRoundSessionController({
    supabase,
    activeRound,
    bulletinContext,
    stationLabel,
    stationPostName,
    actingOfficerName,
    stationModeEnabled,
    checkpointCount: checkpointState.length,
    user,
    activeSessionId,
    setActiveSessionId,
  })

  useRoundBulletinDraft({
    user,
    state: {
      activeRoundId,
      startedAt,
      activeSessionId,
      pendingStartByQr,
      startQrValidated,
      checkpointState,
      scanEvents,
      photos,
      gpsTrack,
      distanceMeters,
      elapsedSeconds,
      notes,
      preRoundCondition,
      preRoundNotes,
      bulletinContext,
    },
    onRestore: (stored) => {
      const restoredCheckpointState = Array.isArray(stored.checkpointState) ? stored.checkpointState as CheckpointState[] : []
      const restoredEvents = Array.isArray(stored.scanEvents) ? stored.scanEvents as ScanEvent[] : []
      const restoredRoundId = String(stored.activeRoundId ?? "").trim()
      const restoredSessionId = String(stored.activeSessionId ?? "").trim() || null
      const restoredStartedAt = String(stored.startedAt ?? "").trim() || null

      if (restoredRoundId) {
        setActiveRoundId(restoredRoundId)
      }
      if (restoredCheckpointState.length > 0) {
        checkpointStateRef.current = restoredCheckpointState
        setCheckpointState(restoredCheckpointState)
      }
      if (restoredEvents.length > 0) {
        setScanEvents(restoredEvents)
      }
      const restoredGpsTrack = getTrackFromUnknownLogs(stored)
      if (restoredGpsTrack.length > 0) {
        latestGpsPointRef.current = restoredGpsTrack[restoredGpsTrack.length - 1] ?? null
        setGpsTrack(restoredGpsTrack)
      }
      const restoredDistanceMeters = Number(stored.distanceMeters)
      if (Number.isFinite(restoredDistanceMeters) && restoredDistanceMeters > 0) {
        setDistanceMeters(restoredDistanceMeters)
      }
      const restoredElapsedSeconds = Number(stored.elapsedSeconds)
      if (Number.isFinite(restoredElapsedSeconds) && restoredElapsedSeconds > 0) {
        setElapsedSeconds(Math.floor(restoredElapsedSeconds))
      }
      if (restoredStartedAt) {
        startedAtRef.current = restoredStartedAt
        setStartedAt(restoredStartedAt)
      }
      if (restoredSessionId) {
        setSessionId(restoredSessionId)
      }

      pendingStartByQrRef.current = Boolean(stored.pendingStartByQr)
      setPendingStartByQr(Boolean(stored.pendingStartByQr))
      setStartQrValidated(Boolean(stored.startQrValidated))
      setNotes(String(stored.notes ?? ""))
      setPreRoundCondition(String(stored.preRoundCondition ?? "NORMAL") || "NORMAL")
      setPreRoundNotes(String(stored.preRoundNotes ?? ""))
      setBulletinContext(stored.bulletinContext && typeof stored.bulletinContext === "object" ? stored.bulletinContext as BulletinContext : null)
    },
  })

  const l1ScopeTokens = useMemo(() => {
    const stationTokens = [stationOperationName, stationPostName, stationLabel]
      .flatMap((value) => String(value ?? "").split(/[|,;\-]/))
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)

    return Array.from(new Set(stationTokens))
  }, [stationLabel, stationOperationName, stationPostName])

  const l1CoverageLabel = useMemo(() => {
    const stationScope = [String(stationOperationName ?? "").trim(), String(stationPostName || stationLabel || "").trim()].filter(Boolean)
    if (stationScope.length > 0) return stationScope.join(" · ")

    return "Puesto operativo sin contexto"
  }, [stationLabel, stationOperationName, stationPostName])

  const prioritizedRounds = useMemo(() => {
    const activeFirst = [...roundsWithCheckpointOverrides].sort((left, right) => {
      const leftActive = String(left.status ?? "").trim().toLowerCase() === "activa" ? 0 : 1
      const rightActive = String(right.status ?? "").trim().toLowerCase() === "activa" ? 0 : 1
      return leftActive - rightActive
    })

    // L4 sees all rounds
    if (roleLevel >= 4) return activeFirst

    // L2/L3: filter by authorized operations (assigned by L4 via catalog)
    if (roleLevel >= 2 && authorizedOperations.length > 0) {
      const scoped = activeFirst.filter((round) => {
        const roundName = String(round.name ?? "").toLowerCase()
        const roundPost = String(round.post ?? "").toLowerCase()
        return authorizedOperations.some((op) => {
          const opName = op.operationName.toLowerCase()
          const clientName = op.clientName.toLowerCase()
          return (
            (!!clientName && roundPost.includes(clientName)) ||
            (!!opName && (roundPost.includes(opName) || roundName.includes(opName)))
          )
        })
      })
      return scoped.length > 0 ? scoped : activeFirst
    }

    // L1: filter by station scope tokens
    if (isL1Operator) {
      if (l1ScopeTokens.length === 0) return []
      const scoped = activeFirst.filter((round) => {
        const haystack = `${String(round.name ?? "")} ${String(round.post ?? "")}`.toLowerCase()
        return l1ScopeTokens.some((token) => haystack.includes(token))
      })
      return scoped.length > 0 ? scoped : activeFirst
    }

    return activeFirst
  }, [authorizedOperations, isL1Operator, l1ScopeTokens, roleLevel, roundsWithCheckpointOverrides])

  const l1RoundTray = useMemo(() => {
    const now = Date.now()
    return prioritizedRounds.slice(0, 6).map((round) => {
      const roundName = String(round.name ?? "")
      const frequencyMinutes = getFrequencyMinutes(String(round.frequency ?? ""))
      const lastReportAt = latestReportByRound.get(roundName) ?? null
      const dueAtMs = lastReportAt ? lastReportAt.getTime() + frequencyMinutes * 60 * 1000 : null
      let status: "EN CURSO" | "VENCIDA" | "POR VENCER" | "PENDIENTE" = "PENDIENTE"

      if (startedAt && String(round.id) === activeRoundId) {
        status = "EN CURSO"
      } else if (dueAtMs == null) {
        status = "PENDIENTE"
      } else if (now >= dueAtMs) {
        status = "VENCIDA"
      } else if (dueAtMs - now <= 10 * 60 * 1000) {
        status = "POR VENCER"
      }

      return {
        id: String(round.id),
        name: roundName || "Ronda",
        post: String(round.post ?? "Puesto"),
        status,
        frequencyMinutes,
        lastReportAt,
      }
    })
  }, [activeRoundId, latestReportByRound, prioritizedRounds, startedAt])

  const l1TurnSummary = useMemo(() => {
    const overdue = l1RoundTray.filter((round) => round.status === "VENCIDA").length
    const dueSoon = l1RoundTray.filter((round) => round.status === "POR VENCER").length
    const inProgress = l1RoundTray.filter((round) => round.status === "EN CURSO").length
    const pending = l1RoundTray.filter((round) => round.status === "PENDIENTE").length
    const nextDueRound = l1RoundTray
      .filter((round) => round.lastReportAt)
      .map((round) => ({
        ...round,
        dueAtMs: (round.lastReportAt?.getTime() ?? 0) + round.frequencyMinutes * 60 * 1000,
      }))
      .sort((left, right) => left.dueAtMs - right.dueAtMs)[0] ?? null

    return {
      overdue,
      dueSoon,
      inProgress,
      pending,
      nextDueRound,
    }
  }, [l1RoundTray])

  const buildCheckpointState = useCallback((round: RoundRow | null) => {
    if (!round) return [] as CheckpointState[]

    return normalizeRoundCheckpoints(round.checkpoints).map((cp, index) => {
      const qrCodes = [...(cp.qrCodes ?? []), ...(cp.qr_codes ?? [])].map((value) => String(value).trim()).filter(Boolean)
      const nfcCodes = [...(cp.nfcCodes ?? []), ...(cp.nfc_codes ?? [])].map((value) => String(value).trim()).filter(Boolean)
      return {
        id: `cp-${index + 1}`,
        name: String(cp.name ?? `Punto ${index + 1}`),
        qrCodes,
        nfcCodes,
        scanCodes: Array.from(new Set([...qrCodes, ...nfcCodes])),
        lat: Number.isFinite(Number(cp.lat)) ? Number(cp.lat) : null,
        lng: Number.isFinite(Number(cp.lng)) ? Number(cp.lng) : null,
        completedAt: null,
        completedByQr: null,
      }
    })
  }, [])

  const handleRoundChange = useCallback((roundId: string) => {
    const nextRound = roundsWithCheckpointOverrides.find((round) => String(round.id) === roundId) ?? null
    const nextCheckpointState = buildCheckpointState(nextRound)
    setActiveRoundId(roundId)
    activeRoundRef.current = nextRound
    checkpointStateRef.current = nextCheckpointState
    startedAtRef.current = null
    pendingStartByQrRef.current = false
    clearSessionId()
    setCheckpointState(nextCheckpointState)
    setStartedAt(null)
    setPendingStartByQr(false)
    setStartQrValidated(false)
    setGpsTrack([])
    setDistanceMeters(0)
    setElapsedSeconds(0)
    setGpsError(null)
    latestGpsPointRef.current = null
    setScanEvents([])
  }, [roundsWithCheckpointOverrides, buildCheckpointState, clearSessionId])

  const completedCount = checkpointState.filter((cp) => cp.completedAt).length
  const totalCount = checkpointState.length
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const nextPendingCheckpoint = useMemo(
    () => checkpointState.find((cp) => !cp.completedAt) ?? null,
    [checkpointState]
  )
  const operationalStatusLabel = useMemo(() => {
    if (startQrValidated && nextPendingCheckpoint) return `Siguiente: ${nextPendingCheckpoint.name}`
    if (startQrValidated) return "Ronda lista para cerrar"
    if (pendingStartByQr) return nfcSupported ? "Esperando primer punto NFC" : "Esperando primer codigo QR"
    return "Lista para iniciar"
  }, [nfcSupported, nextPendingCheckpoint, pendingStartByQr, startQrValidated])

  const quickIncidentLocation = useMemo(() => {
    const parts = [String(activeRound?.post ?? "").trim(), String(nextPendingCheckpoint?.name ?? "").trim()].filter(Boolean)
    return parts.join(" | ") || String(activeRound?.post ?? "General")
  }, [activeRound?.post, nextPendingCheckpoint?.name])

  useEffect(() => {
    if (typeof window === "undefined") return
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalonePwa(standalone)
  }, [])

  useEffect(() => {
    if (!isL1Operator) return
    if (activeRoundId) return
    const firstRound = prioritizedRounds[0]
    if (!firstRound?.id) return
    handleRoundChange(String(firstRound.id))
  }, [activeRoundId, handleRoundChange, isL1Operator, prioritizedRounds])
  const handleQuickIncidentDialogChange = useCallback((open: boolean) => {
    setQuickIncidentOpen(open)
    if (open) return
    setQuickIncidentType("")
    setQuickIncidentDescription("")
    setSavingQuickIncident(false)
  }, [])

  const handleSaveQuickIncident = useCallback(async () => {
    if (stationModeEnabled && !activeOfficerName.trim()) {
      openShiftDialog()
      toast({ title: "Turno requerido", description: "Defina el oficial activo antes de reportar novedad.", variant: "destructive" })
      return
    }

    if (!quickIncidentType.trim() || !quickIncidentDescription.trim()) {
      toast({ title: "Campos requeridos", description: "Tipo y descripcion son obligatorios.", variant: "destructive" })
      return
    }

    setSavingQuickIncident(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        description: quickIncidentDescription.trim(),
        incidentType: quickIncidentType.trim(),
        location: quickIncidentLocation,
        time: nowIso(),
        priorityLevel: "Medium",
        reasoning: stationModeEnabled ? `Novedad registrada desde ${stationLabel || "puesto"}.` : "Novedad registrada desde ronda activa.",
        reportedBy: stationModeEnabled ? `${actingOfficerName} | ${stationLabel || "Puesto"}` : actingOfficerName,
        status: "Abierto",
        }),
      })

      const result = (await response.json().catch(() => ({}))) as { error?: string; ok?: boolean }

      if (!response.ok) {
        toast({ title: "Error", description: String(result.error ?? "No se pudo registrar la novedad."), variant: "destructive" })
        return
      }

      toast({
        title: "Novedad registrada",
        description: "La novedad quedo guardada desde la ronda activa.",
      })
      setQuickIncidentOpen(false)
      setQuickIncidentType("")
      setQuickIncidentDescription("")
    } catch {
      toast({ title: "Error", description: "No se pudo registrar la novedad. Intente de nuevo.", variant: "destructive" })
    } finally {
      setSavingQuickIncident(false)
    }
  }, [actingOfficerName, activeOfficerName, openShiftDialog, quickIncidentDescription, quickIncidentLocation, quickIncidentType, stationLabel, stationModeEnabled, supabase, toast])

  const filteredReports = useMemo(() => {
    const operationNeedle = historyOperationFilter.trim().toLowerCase()
    const locationNeedle = historyLocationFilter.trim().toLowerCase()
    const supervisorNeedle = historySupervisorFilter.trim().toLowerCase()
    const hourNeedle = historyHourFilter.trim()

    return effectiveScopedReports.filter((report) => {
      const date = getReportCreatedDate(report)
      const dateKey = date && !Number.isNaN(date.getTime())
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
        : ""
      const hourKey = date && !Number.isNaN(date.getTime())
        ? `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
        : ""
      const operationValue = getReportRoundName(report).toLowerCase()
      const locationValue = getReportPostName(report).toLowerCase()
      const supervisorValue = [
        getReportSupervisorName(report).toLowerCase(),
        String(report.supervisorId ?? report.supervisor_id ?? "").toLowerCase(),
        getReportOfficerName(report).toLowerCase(),
      ].join(" ")

      if (historyDateFromFilter && dateKey && dateKey < historyDateFromFilter) return false
      if (historyDateFromFilter && !dateKey) return false
      if (historyDateToFilter && dateKey && dateKey > historyDateToFilter) return false
      if (historyDateToFilter && !dateKey) return false
      if (hourNeedle && !hourKey.includes(hourNeedle)) return false
      if (operationNeedle && !operationValue.includes(operationNeedle)) return false
      if (locationNeedle && !locationValue.includes(locationNeedle)) return false
      if (supervisorNeedle && !supervisorValue.includes(supervisorNeedle)) return false
      return true
    })
  }, [
    effectiveScopedReports,
    historyDateFromFilter,
    historyDateToFilter,
    historyHourFilter,
    historyOperationFilter,
    historyLocationFilter,
    historySupervisorFilter,
  ])

  const applyQuickRange = useCallback((days: number) => {
    const today = new Date()
    const end = toInputDateLocal(today)
    const startDate = new Date(today)
    startDate.setDate(startDate.getDate() - (days - 1))
    const start = toInputDateLocal(startDate)
    setHistoryDateFromFilter(start)
    setHistoryDateToFilter(end)
  }, [])

  const trackPath = useMemo(() => buildTrackSvgPath(gpsTrack, 340, 140), [gpsTrack])
  const distanceKm = useMemo(() => distanceMeters / 1000, [distanceMeters])
  const latestGpsPoint = useMemo(() => gpsTrack[gpsTrack.length - 1] ?? null, [gpsTrack])
  const historyTrack = useMemo(() => (historyTrackReport ? getReportTrack(historyTrackReport) : []), [historyTrackReport])
  const historyTrackPath = useMemo(() => buildTrackSvgPath(historyTrack, 520, 220), [historyTrack])
  const historyMapCenter = useMemo<[number, number]>(() => {
    if (historyTrack.length === 0) return [-84.0907, 9.9281]
    const lat = historyTrack.reduce((sum, p) => sum + p.lat, 0) / historyTrack.length
    const lng = historyTrack.reduce((sum, p) => sum + p.lng, 0) / historyTrack.length
    return [lng, lat]
  }, [historyTrack])
  const historyMapMarkers = useMemo(() => {
    if (historyTrack.length === 0) return [] as Array<{ lng: number; lat: number; color?: string; title?: string }>
    const first = historyTrack[0]
    const last = historyTrack[historyTrack.length - 1]
    const checkpointMarkers = historyTrackReport
      ? getRoundCheckpointWaypoints(historyTrackReport).map((checkpoint) => ({
          lng: checkpoint.lng,
          lat: checkpoint.lat,
          color: checkpoint.symbol === "Flag, Green" ? "#06b6d4" : "#eab308",
          title: checkpoint.description ? `${checkpoint.name} | ${checkpoint.description}` : checkpoint.name,
        }))
      : []
    return [
      { lng: first.lng, lat: first.lat, color: "#22c55e", title: "Inicio" },
      { lng: last.lng, lat: last.lat, color: "#f97316", title: "Fin" },
      ...checkpointMarkers,
    ]
  }, [historyTrack, historyTrackReport])

  const recentFraudNotifications = useMemo(() => {
    return effectiveScopedReports
      .map((r) => {
        const messages = getStoredAlertMessages(r)
        if (messages.length === 0) return null
        return {
          id: r.id,
          at: r.createdAt?.toDate?.() ?? null,
          roundName: String(r.roundName ?? "Ronda"),
          officerName: String(r.officerName ?? "Oficial"),
          messages,
        }
      })
      .filter((v): v is { id: string; at: Date | null; roundName: string; officerName: string; messages: string[] } => v !== null)
      .slice(0, 5)
  }, [effectiveScopedReports])

  const downloadGpxFromReport = useCallback((report: RoundReportRow) => {
    const points = getReportTrack(report)
    if (points.length < 2) {
      toast({ title: "Sin trazado GPX", description: "Esta boleta no tiene suficientes puntos GPS.", variant: "destructive" })
      return
    }
    const baseDate = report.createdAt?.toDate?.() ?? new Date()
    const code = `${baseDate.getFullYear()}${String(baseDate.getMonth() + 1).padStart(2, "0")}${String(baseDate.getDate()).padStart(2, "0")}`
    const name = `Ronda ${String(report.roundName ?? "SinNombre")} ${code}`
    const waypoints = getRoundCheckpointWaypoints(report)
    const xml = buildGpxXml(points, name, waypoints)
    const blob = new Blob([xml], { type: "application/gpx+xml;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `gpx-ronda-${String(report.id).slice(0, 8)}.gpx`
    a.click()
    URL.revokeObjectURL(url)
  }, [toast])

  const handleExportSingleExcel = useCallback(async (report: RoundReportRow) => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const reportDate = getReportCreatedDate(report)
    const startedAt = getReportStartedDate(report)
    const endedAt = getReportEndedDate(report)
    const details = getRoundLogDetails(report)

    const row = {
      codigo: getRoundReportCode(report),
      fechaRegistro: formatRoundExportDateTime(reportDate),
      inicio: formatRoundExportDateTime(startedAt),
      fin: formatRoundExportDateTime(endedAt),
      ronda: String(report.roundName ?? "-"),
      lugar: String(report.postName ?? "-"),
      oficial: String(report.officerName ?? "-"),
      supervisor: String(report.supervisorName ?? report.supervisorId ?? report.officerName ?? "-"),
      estado: String(report.status ?? "-"),
      avance: `${Number(report.checkpointsCompleted ?? 0)}/${Number(report.checkpointsTotal ?? 0)}`,
      cumplimiento: getRoundCompletionRateLabel(report),
      preRonda: details.preRoundCondition,
      checklistPreRonda: details.preRoundChecklist,
      notasPreRonda: details.preRoundNotes,
      gpsInicio: details.gpsStart,
      gpsFin: details.gpsEnd,
      distanciaKm: details.distanceKm,
      duracion: details.duration,
      evidencias: details.evidenceCount,
      resumenEventos: details.eventSummary,
      checkpointsCompletados: details.completedCheckpoints,
      checkpointsPendientes: details.pendingCheckpoints,
      alertas: details.alertSummary,
      contextoTurno: details.shiftContext,
      observaciones: String(report.notes ?? "-") || "-",
    }

    const result = await exportToExcel(
      [row],
      "Boleta Ronda",
      [
        { header: "CODIGO", key: "codigo", width: 20 },
        { header: "FECHA REGISTRO", key: "fechaRegistro", width: 22 },
        { header: "INICIO", key: "inicio", width: 22 },
        { header: "FIN", key: "fin", width: 22 },
        { header: "RONDA", key: "ronda", width: 24 },
        { header: "LUGAR", key: "lugar", width: 20 },
        { header: "OFICIAL", key: "oficial", width: 20 },
        { header: "SUPERVISOR", key: "supervisor", width: 20 },
        { header: "ESTADO", key: "estado", width: 12 },
        { header: "AVANCE", key: "avance", width: 12 },
        { header: "CUMPLIMIENTO", key: "cumplimiento", width: 14 },
        { header: "PRE-RONDA", key: "preRonda", width: 14 },
        { header: "CHECKLIST PRE-RONDA", key: "checklistPreRonda", width: 34 },
        { header: "NOTAS PRE-RONDA", key: "notasPreRonda", width: 34 },
        { header: "GPS INICIO", key: "gpsInicio", width: 22 },
        { header: "GPS FIN", key: "gpsFin", width: 22 },
        { header: "DISTANCIA KM", key: "distanciaKm", width: 14 },
        { header: "DURACION", key: "duracion", width: 12 },
        { header: "EVIDENCIAS", key: "evidencias", width: 12 },
        { header: "RESUMEN EVENTOS", key: "resumenEventos", width: 34 },
        { header: "CHECKPOINTS COMPLETADOS", key: "checkpointsCompletados", width: 34 },
        { header: "CHECKPOINTS PENDIENTES", key: "checkpointsPendientes", width: 34 },
        { header: "ALERTAS", key: "alertas", width: 50 },
        { header: "CONTEXTO TURNO", key: "contextoTurno", width: 42 },
        { header: "OBSERVACIONES", key: "observaciones", width: 42 },
      ],
      `HO_BOLETA_RONDA_${getRoundReportCode(report)}`
    )

    if (result.ok) toast({ title: "Excel individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }, [toast])

  const handleExportSinglePdf = useCallback(async (report: RoundReportRow) => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const reportDate = getReportCreatedDate(report)
    const startedAt = getReportStartedDate(report)
    const endedAt = getReportEndedDate(report)
    const details = getRoundLogDetails(report)

    const rows: (string | number)[][] = [[
      getRoundReportCode(report),
      [
        `Registro: ${formatRoundExportDateTime(reportDate)}`,
        `Inicio: ${formatRoundExportDateTime(startedAt)}`,
        `Fin: ${formatRoundExportDateTime(endedAt)}`,
        `Estado: ${String(report.status ?? "-")}`,
        `Avance: ${Number(report.checkpointsCompleted ?? 0)}/${Number(report.checkpointsTotal ?? 0)}`,
        `Cumplimiento: ${getRoundCompletionRateLabel(report)}`,
      ].join("\n"),
      [
        `Ronda: ${String(report.roundName ?? "-")}`,
        `Puesto: ${String(report.postName ?? "-")}`,
      ].join("\n"),
      [
        `Oficial: ${String(report.officerName ?? "-")}`,
        `Supervisor: ${String(report.supervisorName ?? report.supervisorId ?? report.officerName ?? "-")}`,
      ].join("\n"),
      [
        `Condicion: ${details.preRoundCondition}`,
        `Checklist: ${details.preRoundChecklist}`,
        `Notas: ${details.preRoundNotes}`,
      ].join("\n"),
      [
        `GPS inicio: ${details.gpsStart}`,
        `GPS fin: ${details.gpsEnd}`,
        `KM: ${details.distanceKm}`,
        `Duracion: ${details.duration}`,
        `Evidencias: ${details.evidenceCount}`,
        details.eventSummary,
      ].join("\n"),
      [
        `Completados: ${details.completedCheckpoints}`,
        `Pendientes: ${details.pendingCheckpoints}`,
      ].join("\n"),
      [
        details.alertSummary,
        details.shiftContext,
      ].join("\n"),
      [
        `Boleta: ${String(report.notes ?? "-") || "-"}`,
      ].join("\n"),
    ]]

    const result = await exportToPdf(
      "BOLETA DE RONDA - INDIVIDUAL",
      ["CODIGO", "FECHA / ESTADO", "RONDA", "PERSONAL", "PRE-RONDA", "EJECUCION", "CHECKPOINTS", "ALERTAS / TURNO", "OBSERVACIONES"],
      rows,
      `HO_BOLETA_RONDA_${getRoundReportCode(report)}`
    )

    if (result.ok) toast({ title: "PDF individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }, [toast])

  const handleOpenRoundDetail = useCallback((report: RoundReportRow) => {
    setHistoryDetailReport(report)
    setHistoryDetailOpen(true)
  }, [])

  const handleOpenRoundPhoto = useCallback((photo: string) => {
    if (openDataUrlInNewTab(photo)) return
    toast({ title: "No se pudo abrir la imagen", description: "Revise si el navegador bloqueó la nueva pestaña.", variant: "destructive" })
  }, [toast])

  const handleDownloadRoundPhoto = useCallback((report: RoundReportRow, photo: string, index: number) => {
    if (downloadDataUrlAsFile(photo, buildRoundPhotoFileName(report, index))) return
    toast({ title: "No se pudo descargar", description: "La evidencia no tiene un formato válido para descarga.", variant: "destructive" })
  }, [toast])

  const handleDownloadAllRoundPhotos = useCallback((report: RoundReportRow) => {
    const photos = getRoundLogPhotos(report)
    if (photos.length === 0) return
    photos.forEach((photo, index) => {
      window.setTimeout(() => {
        handleDownloadRoundPhoto(report, photo, index)
      }, index * 120)
    })
  }, [handleDownloadRoundPhoto])

  const handleGenerateAiSummary = useCallback(async (report: RoundReportRow) => {
    if (!canGenerateAiSummary) {
      toast({ title: "IA restringida", description: "La generación IA está disponible solo para L3/L4.", variant: "destructive" })
      return
    }

    const reportId = String(report.id ?? "").trim()
    if (!reportId) return

    const safeDate = getReportCreatedDate(report)
    const logDetails = getRoundLogDetails(report)
    const payload = {
      reportCode: getRoundReportCode(report),
      date: safeDate?.toLocaleDateString?.() ?? "-",
      hour: safeDate?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-",
      roundName: String(report.roundName ?? "-"),
      postName: String(report.postName ?? "-"),
      officerName: String(report.officerName ?? "-"),
      supervisorName: String(report.supervisorName ?? report.supervisorId ?? report.officerName ?? "-"),
      status: String(report.status ?? "-"),
      progress: `${Number(report.checkpointsCompleted ?? 0)}/${Number(report.checkpointsTotal ?? 0)}`,
      preRoundCondition: logDetails.preRoundCondition,
      distanceKm: logDetails.distanceKm,
      duration: logDetails.duration,
      evidenceCount: Number(logDetails.evidenceCount ?? 0),
      alerts: getStoredAlertMessages(report),
      notes: String(report.notes ?? ""),
    }

    setAiSummaryLoadingId(reportId)
    setAiSummaryText("")
    setAiSummaryReportCode(payload.reportCode)
    setAiSummaryOpen(true)

    try {
      const response = await fetchInternalApi(supabase, "/api/ai/round-summary", {
        method: "POST",
        body: JSON.stringify(payload),
      })

      const data = (await response.json()) as { summary?: string; error?: string }
      if (!response.ok) {
        setAiSummaryOpen(false)
        toast({ title: "IA no disponible", description: String(data.error ?? "No se pudo generar el resumen."), variant: "destructive" })
        return
      }

      setAiSummaryText(String(data.summary ?? "Sin resumen generado."))
    } catch {
      setAiSummaryOpen(false)
      toast({ title: "IA no disponible", description: "Error de red al generar resumen IA.", variant: "destructive" })
    } finally {
      setAiSummaryLoadingId("")
    }
  }, [canGenerateAiSummary, supabase, toast])

  const handleOpenRoundEdit = useCallback((report: RoundReportRow) => {
    if (!canEditRoundReports) return
    setHistoryEditId(String(report.id))
    setHistoryEditRoundName(String(report.roundName ?? ""))
    setHistoryEditPostName(String(report.postName ?? ""))
    setHistoryEditOfficerName(String(report.officerName ?? ""))
    setHistoryEditSupervisorName(String(report.supervisorName ?? report.supervisorId ?? ""))
    const rawStatus = String(report.status ?? "COMPLETA").toUpperCase()
    setHistoryEditStatus(rawStatus.includes("PARC") ? "PARCIAL" : "COMPLETA")
    setHistoryEditNotes(String(report.notes ?? ""))
    setHistoryEditOpen(true)
  }, [canEditRoundReports])

  const handleSaveRoundEdit = useCallback(async () => {
    if (!canEditRoundReports || !historyEditId) return

    setIsSavingHistoryEdit(true)
    const payload = toSnakeCaseKeys({
      roundName: historyEditRoundName.trim() || null,
      postName: historyEditPostName.trim() || null,
      officerName: historyEditOfficerName.trim() || null,
      supervisorName: historyEditSupervisorName.trim() || null,
      status: historyEditStatus,
      notes: historyEditNotes.trim() || null,
    }) as Record<string, unknown>

    try {
      const response = await fetchInternalApi(supabase, "/api/round-reports", {
        method: "PATCH",
        body: JSON.stringify({ id: historyEditId, ...payload }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string; warning?: string | null } | null
      setIsSavingHistoryEdit(false)

      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo actualizar la boleta."), variant: "destructive" })
        return
      }

      toast({
        title: result?.warning ? "Boleta actualizada con compatibilidad" : "Boleta actualizada",
        description: String(result?.warning ?? "Cambios aplicados correctamente."),
        variant: result?.warning ? "destructive" : "default",
      })
      void reload(false)
      setHistoryEditOpen(false)
    } catch {
      setIsSavingHistoryEdit(false)
      toast({ title: "Error", description: "No se pudo actualizar la boleta.", variant: "destructive" })
    }
  }, [canEditRoundReports, historyEditId, historyEditNotes, historyEditOfficerName, historyEditPostName, historyEditRoundName, historyEditStatus, historyEditSupervisorName, reload, supabase, toast])

  const handleDeleteRoundReport = useCallback(async (report: RoundReportRow) => {
    if (!canEditRoundReports) return

    const reportId = String(report.id ?? "").trim()
    if (!reportId) return

    const confirmed = window.confirm("¿Eliminar esta boleta de ronda? Esta acción no se puede deshacer.")
    if (!confirmed) return

    setDeletingHistoryReportId(reportId)
    try {
      const response = await fetchInternalApi(supabase, "/api/round-reports", {
        method: "DELETE",
        body: JSON.stringify({ id: reportId }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      setDeletingHistoryReportId("")

      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo eliminar la boleta."), variant: "destructive" })
        return
      }

      toast({
        title: "Boleta eliminada",
        description: "La boleta fue eliminada correctamente.",
      })
      void reload(false)
    } catch {
      setDeletingHistoryReportId("")
      toast({ title: "Error", description: "No se pudo eliminar la boleta.", variant: "destructive" })
    }
  }, [canEditRoundReports, reload, supabase, toast])

  const handleSaveSecurityConfig = useCallback(async () => {
    if (!canEditFraudConfig || !user) return
    setIsSavingSecurityConfig(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/rounds/security-config", {
        method: "POST",
        body: JSON.stringify({
          geofenceRadiusMeters: localDraftSecurityConfig.geofenceRadiusMeters,
          noScanGapMinutes: localDraftSecurityConfig.noScanGapMinutes,
          maxJumpMeters: localDraftSecurityConfig.maxJumpMeters,
        }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        const detail = String(body?.error ?? "").trim()
        toast({
          title: "No se pudo guardar config",
          description: detail
            ? `Error servidor: ${detail}`
            : "Verifique tabla round_security_config. Ejecute supabase/create_round_security_config.sql.",
          variant: "destructive",
        })
        return
      }

      toast({ title: "Config guardada", description: "Geofencing y antifraude actualizados para todos los dispositivos." })
      void reload(false)
    } catch (error) {
      const detail = error instanceof Error ? String(error.message ?? "").trim() : ""
      toast({
        title: "No se pudo guardar config",
        description: detail
          ? `Error servidor: ${detail}`
          : "Verifique tabla round_security_config. Ejecute supabase/create_round_security_config.sql.",
        variant: "destructive",
      })
    } finally {
      setIsSavingSecurityConfig(false)
    }
  }, [canEditFraudConfig, localDraftSecurityConfig, reload, supabase, toast, user])

  const handleOpenRoundDefinitionEdit = useCallback((round: RoundRow | null) => {
    if (!canManageRoundDefinitions || !round) return
    setRoundEditId(String(round.id ?? ""))
    setRoundEditName(String(round.name ?? ""))
    setRoundEditPost(String(round.post ?? ""))
    setRoundEditStatus(String(round.status ?? "Activa") || "Activa")
    setRoundEditFrequency(String(round.frequency ?? "Cada 30 minutos") || "Cada 30 minutos")
    setRoundEditInstructions(String(round.instructions ?? ""))
    setRoundEditCheckpoints(normalizeRoundCheckpoints(round.checkpoints).map((cp) => ({ ...cp })))
    setRoundEditOpen(true)
  }, [canManageRoundDefinitions])

  const handleSaveRoundDefinitionEdit = useCallback(async () => {
    if (!canManageRoundDefinitions || !roundEditId) return

    const cleanName = roundEditName.trim()
    const cleanPost = roundEditPost.trim()
    const cleanCheckpoints = roundEditCheckpoints
      .map((cp, index) => ({
        ...cp,
        name: String(cp.name ?? "").trim() || `Punto ${index + 1}`,
      }))
      .filter((cp) => String(cp.name ?? "").trim().length > 0)

    if (!cleanName || !cleanPost) {
      toast({ title: "Campos requeridos", description: "Nombre de ronda y puesto son obligatorios.", variant: "destructive" })
      return
    }

    setIsSavingRoundEdit(true)
    const payload = toSnakeCaseKeys({
      name: cleanName,
      post: cleanPost,
      status: roundEditStatus || "Activa",
      frequency: roundEditFrequency || "Cada 30 minutos",
      instructions: roundEditInstructions.trim() || null,
      checkpoints: cleanCheckpoints,
    }) as Record<string, unknown>

    try {
      const response = await fetchInternalApi(supabase, "/api/rounds", {
        method: "PATCH",
        body: JSON.stringify({ id: roundEditId, ...payload }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null

      setIsSavingRoundEdit(false)
      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo actualizar la ronda."), variant: "destructive" })
        return
      }

      toast({
        title: "Ronda actualizada",
        description: "Cambios aplicados correctamente.",
      })
      void reload(false)
      setRoundEditOpen(false)
    } catch {
      setIsSavingRoundEdit(false)
      toast({ title: "Error", description: "No se pudo actualizar la ronda.", variant: "destructive" })
    }
  }, [canManageRoundDefinitions, reload, roundEditCheckpoints, roundEditFrequency, roundEditId, roundEditInstructions, roundEditName, roundEditPost, roundEditStatus, supabase, toast])

  const handleDeleteRoundDefinition = useCallback(async (round: RoundRow | null) => {
    if (!canManageRoundDefinitions || !round) return

    const roundId = String(round.id ?? "").trim()
    if (!roundId) return

    const confirmed = window.confirm("¿Eliminar esta ronda? Esta acción no se puede deshacer.")
    if (!confirmed) return

    setDeletingRoundId(roundId)

    try {
      const response = await fetchInternalApi(supabase, "/api/rounds", {
        method: "DELETE",
        body: JSON.stringify({ id: roundId }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      setDeletingRoundId("")

      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo eliminar la ronda."), variant: "destructive" })
        return
      }

      if (activeRoundId === roundId) {
        setActiveRoundId("")
        setCheckpointState([])
        setPendingStartByQr(false)
        setStartQrValidated(false)
        setStartedAt(null)
      }

      toast({
        title: "Ronda eliminada",
        description: "La ronda fue eliminada correctamente.",
      })
      void reload(false)
    } catch {
      setDeletingRoundId("")
      toast({ title: "Error", description: "No se pudo eliminar la ronda.", variant: "destructive" })
    }
  }, [activeRoundId, canManageRoundDefinitions, reload, supabase, toast])

  useEffect(() => {
    if (typeof window === "undefined") return
    const payload = JSON.stringify(localDraftSecurityConfig)
    window.localStorage.setItem("ho_round_security_config_v1", payload)
  }, [localDraftSecurityConfig])

  const stopNfcScan = useCallback(() => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort()
      nfcAbortRef.current = null
    }
    setIsNfcScanning(false)
  }, [])

  useEffect(() => {
    return () => {
      stopNfcScan()
    }
  }, [stopNfcScan])

  const applyScannedValueRef = useRef<(rawValue: string) => ApplyScanResult>(() => null)
  const sendRoundEventForSessionRef = useRef<(sessionId: string, event: ScanEvent, token?: string) => Promise<void>>(async () => {})
  const startRoundSessionRef = useRef<(startedIso: string) => Promise<string | null>>(async () => null)
  const { videoRef, isScanning, scanError, qrSupported, startScanner, stopScanner } = useQrScanner({
    onDetected: (rawValue) => applyScannedValueRef.current(rawValue),
    autoStopOnDetected: false,
    errorNoCamera: "Este navegador no permite acceso a camara.",
    errorCameraStart: "No se pudo iniciar la camara. Revise permisos.",
  })

  const resetStartAttempt = useCallback(() => {
    stopNfcScan()
    stopScanner()
    pendingStartByQrRef.current = false
    setPendingStartByQr(false)
    setStartQrValidated(false)
    setQrOpen(false)
  }, [stopNfcScan, stopScanner])

  const applyScannedValue = useCallback((rawValue: string): ApplyScanResult => {
    const clean = rawValue.trim()
    if (!clean) return null
    const normalized = normalizeScanToken(clean)
    const checkpointSnapshot = checkpointStateRef.current
    const activeRoundSnapshot = activeRoundRef.current
    const startedAtSnapshot = startedAtRef.current
    const pendingStartSnapshot = pendingStartByQrRef.current
    const activeSessionSnapshot = activeSessionIdRef.current
    const startMatchIndex = checkpointSnapshot.findIndex(
      (cp) => cp.scanCodes.some((code) => normalizeScanToken(code) === normalized)
    )
    const startCheckpoint = startMatchIndex >= 0 ? checkpointSnapshot[startMatchIndex] : null

    if ((pendingStartSnapshot && activeRoundSnapshot) || (!startedAtSnapshot && activeRoundSnapshot && startMatchIndex >= 0)) {
      const required = startCheckpoint
      if (!required || startMatchIndex < 0) {
        toast({ title: "Codigo de inicio invalido", description: "La etiqueta no coincide con ningun checkpoint configurado para esta ronda.", variant: "destructive" })
        return null
      }

      const at = nowIso()
      startedAtRef.current = at
      pendingStartByQrRef.current = false
      setStartedAt(at)
      setStartQrValidated(true)
      setPendingStartByQr(false)
      setCheckpointState((prev) => {
        const next = prev.map((cp, idx) => idx === startMatchIndex ? { ...cp, completedAt: cp.completedAt ?? at, completedByQr: cp.completedByQr ?? clean } : cp)
        checkpointStateRef.current = next
        return next
      })
      const gps = latestGpsPointRef.current
      const event: ScanEvent = {
        at,
        qrValue: clean,
        type: "checkpoint_match" as const,
        checkpointId: required?.id,
        checkpointName: required?.name,
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
        geofenceDistanceMeters: (required && gps && typeof required.lat === "number" && typeof required.lng === "number")
          ? Math.round(haversineDistanceMeters({ lat: required.lat, lng: required.lng }, gps))
          : undefined,
      }
      setScanEvents((prev) => [event, ...prev].slice(0, 30))
      void (async () => {
        const sessionId = (await startRoundSessionRef.current(at)) ?? activeSessionIdRef.current
        if (sessionId) {
          await sendRoundEventForSessionRef.current(sessionId, event, clean)
        }
      })()
      toast({
        title: "Ronda iniciada",
        description: pendingStartSnapshot
          ? `${required.name} validado y ronda iniciada.`
          : `${required.name} validado y ronda iniciada.`,
      })
      stopScanner()
      setQrOpen(false)
      return { checkpointName: required.name ?? "Inicio" }
    }

    const roundFromQr = normalizeRoundQr(clean)
    if (roundFromQr) {
      const exists = rounds.find((r) => String(r.id) === roundFromQr.id)
      if (exists) {
        handleRoundChange(roundFromQr.id)
        setScanEvents((prev) => [{ at: nowIso(), qrValue: clean, type: "round_selected" as const }, ...prev].slice(0, 30))
        toast({ title: "Ronda cargada", description: `${roundFromQr.name || "Ronda"} lista para boleta.` })
        return null
      }
    }

    if (!startedAtSnapshot) {
      toast({ title: "Inicie la boleta", description: "Seleccione ronda y pulse INICIAR antes de escanear checkpoints.", variant: "destructive" })
      return null
    }

    const matchIndex = checkpointSnapshot.findIndex(
      (cp) => !cp.completedAt && cp.scanCodes.some((code) => normalizeScanToken(code) === normalized)
    )

    if (matchIndex < 0) {
      const gps = latestGpsPointRef.current
      const event: ScanEvent = {
        at: nowIso(),
        qrValue: clean,
        type: "checkpoint_unmatched" as const,
        checkpointId: "unmatched",
        checkpointName: "No reconocido",
        lat: gps?.lat,
        lng: gps?.lng,
        accuracy: gps?.accuracy,
      }
      setScanEvents((prev) => [event, ...prev].slice(0, 30))
      if (activeSessionSnapshot) {
        void sendRoundEventForSessionRef.current(activeSessionSnapshot, event, clean)
      }
      toast({ title: "Codigo no reconocido", description: "No coincide con checkpoints pendientes de la ronda.", variant: "destructive" })
      return null
    }

    const matched = checkpointSnapshot[matchIndex]
    const at = nowIso()
    const gps = latestGpsPointRef.current
    const geofenceDistance = (gps && typeof matched.lat === "number" && typeof matched.lng === "number")
      ? Math.round(haversineDistanceMeters({ lat: matched.lat, lng: matched.lng }, gps))
      : null
    const outsideGeofence = typeof geofenceDistance === "number" && geofenceDistance > geofenceRadiusMeters

    if (!outsideGeofence) {
      setCheckpointState((prev) => {
        const next = prev.map((cp, idx) => idx === matchIndex ? { ...cp, completedAt: at, completedByQr: clean } : cp)
        checkpointStateRef.current = next
        return next
      })
    }

    const event: ScanEvent = {
      at,
      qrValue: clean,
      type: "checkpoint_match" as const,
      checkpointId: matched.id,
      checkpointName: matched.name,
      lat: gps?.lat,
      lng: gps?.lng,
      accuracy: gps?.accuracy,
      geofenceDistanceMeters: geofenceDistance ?? undefined,
      geofenceInside: typeof geofenceDistance === "number" ? geofenceDistance <= geofenceRadiusMeters : undefined,
      fraudFlag: outsideGeofence ? "scan_outside_geofence" : null,
    }
    setScanEvents((prev) => [event, ...prev].slice(0, 30))
    if (activeSessionSnapshot) {
      void sendRoundEventForSessionRef.current(activeSessionSnapshot, event, clean)
    }

    if (outsideGeofence) {
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate([120, 80, 120])
      toast({ title: "Checkpoint fuera de geofence", description: `${matched.name} escaneado a ${geofenceDistance}m (radio ${geofenceRadiusMeters}m).`, variant: "destructive" })
      return null
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(90)
    toast({ title: "Checkpoint validado", description: `${matched.name} marcado como completado.` })
    return { checkpointName: matched.name }
  }, [activeSessionIdRef, geofenceRadiusMeters, handleRoundChange, rounds, stopScanner, toast])

  useEffect(() => {
    applyScannedValueRef.current = applyScannedValue
  }, [applyScannedValue])

  useEffect(() => {
    activeRoundRef.current = activeRound
  }, [activeRound])

  useEffect(() => {
    checkpointStateRef.current = checkpointState
  }, [checkpointState])

  useEffect(() => {
    startedAtRef.current = startedAt
  }, [startedAt])

  useEffect(() => {
    pendingStartByQrRef.current = pendingStartByQr
  }, [pendingStartByQr])

  const startNfcScan = useCallback(async () => {
    if (!nfcSupported) {
      toast({ title: "NFC no soportado", description: "Este dispositivo/navegador no permite lectura NFC web.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: (options?: { signal?: AbortSignal }) => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detecto API NDEFReader en este navegador.", variant: "destructive" })
      return
    }

    try {
      stopNfcScan()
      const controller = new AbortController()
      nfcAbortRef.current = controller
      const reader = new NdefCtor()
      await reader.scan({ signal: controller.signal })
      setIsNfcScanning(true)
      toast({ title: "NFC activo", description: "Acerque una etiqueta NFC para validar checkpoint." })

      reader.onreading = (event) => {
        const token = extractNfcToken(event)
        if (!token) return
        applyScannedValueRef.current(token)
        stopNfcScan()
      }

      reader.onreadingerror = () => {
        if (!startedAt) {
          setPendingStartByQr(false)
          setStartQrValidated(false)
        }
        toast({ title: "Error NFC", description: "No se pudo leer la etiqueta NFC.", variant: "destructive" })
      }
    } catch {
      stopNfcScan()
      if (!startedAt) {
        setPendingStartByQr(false)
        setStartQrValidated(false)
      }
      toast({ title: "NFC bloqueado", description: "No se pudo iniciar lector NFC. Revise permisos y HTTPS.", variant: "destructive" })
    }
  }, [nfcSupported, startedAt, stopNfcScan, toast])

  const handleQrOpenChange = useCallback((open: boolean) => {
    setQrOpen(open)
    if (open) {
      void startScanner()
      return
    }
    stopScanner()
    if (!startedAt) {
      setPendingStartByQr(false)
      setStartQrValidated(false)
    }
  }, [startScanner, startedAt, stopScanner])

  useEffect(() => {
    if (startedAt || pendingStartByQr) return
    stopScanner()
    setQrOpen(false)
  }, [pendingStartByQr, startedAt, stopScanner])

  useEffect(() => {
    sendRoundEventForSessionRef.current = sendRoundEventForSession
  }, [sendRoundEventForSession])

  useEffect(() => {
    startRoundSessionRef.current = startRoundSession
  }, [startRoundSession])

  const handleStartBulletin = () => {
    if (stationModeEnabled && !activeOfficerName.trim()) {
      openShiftDialog()
      toast({ title: "Turno requerido", description: "Indique el oficial activo antes de iniciar la ronda.", variant: "destructive" })
      return
    }

    if (!activeRound) {
      toast({ title: "Seleccione una ronda", description: "Debe elegir una ronda antes de iniciar.", variant: "destructive" })
      return
    }
    if (!checkpointStateRef.current.length) {
      const nextCheckpointState = buildCheckpointState(activeRound)
      checkpointStateRef.current = nextCheckpointState
      setCheckpointState(nextCheckpointState)
    }
    if (!preRoundCondition) {
      toast({ title: "Pre-ronda incompleta", description: "Indique estado del lugar antes de iniciar.", variant: "destructive" })
      return
    }

    setBulletinContext({
      stationLabel: String(stationLabel || stationPostName || activeRound.post || "").trim(),
      stationPostName: String(stationPostName || activeRound.post || "").trim(),
      officerName: actingOfficerName,
      roundId: String(activeRound.id ?? "").trim(),
      roundName: String(activeRound.name ?? "").trim(),
    })
    pendingStartByQrRef.current = true
    setPendingStartByQr(true)
    setStartQrValidated(false)
    setGpsError("geolocation" in navigator ? null : "GPS no disponible en este dispositivo.")
    setScanEvents((prev) => [{ at: nowIso(), qrValue: activeRound.id, type: "round_selected" as const }, ...prev].slice(0, 30))
    if (nfcSupported) {
      toast({ title: "Listo para iniciar", description: "Acerque el primer punto NFC para arrancar la ronda." })
      void startNfcScan()
      return
    }

    toast({ title: "Listo para iniciar", description: "Escanee el primer codigo QR asignado para arrancar la ronda." })
    void handleQrOpenChange(true)
  }

  const markCheckpointManual = (checkpointId: string) => {
    if (!canManualCheckpointValidation) {
      toast({ title: "Accion restringida", description: "Solo L4 puede validar checkpoints en modo manual.", variant: "destructive" })
      return
    }
    const cp = checkpointStateRef.current.find((item) => item.id === checkpointId)
    if (!cp) return
    const at = nowIso()

    if (!startedAt) {
      if (stationModeEnabled && !activeOfficerName.trim()) {
        openShiftDialog()
        toast({ title: "Turno requerido", description: "Indique el oficial activo antes de gestionar el checkpoint manualmente.", variant: "destructive" })
        return
      }
      if (!activeRound) {
        toast({ title: "Seleccione una ronda", description: "Debe elegir una ronda antes de gestionar checkpoints.", variant: "destructive" })
        return
      }
      if (!preRoundCondition) {
        toast({ title: "Pre-ronda incompleta", description: "Indique estado del lugar antes de iniciar manualmente.", variant: "destructive" })
        return
      }

      const context = bulletinContext ?? {
        stationLabel: String(stationLabel || stationPostName || activeRound.post || "").trim(),
        stationPostName: String(stationPostName || activeRound.post || "").trim(),
        officerName: actingOfficerName,
        roundId: String(activeRound.id ?? "").trim(),
        roundName: String(activeRound.name ?? "").trim(),
      }

      setBulletinContext(context)
      startedAtRef.current = at
      pendingStartByQrRef.current = false
      setStartedAt(at)
      setPendingStartByQr(false)
      setStartQrValidated(true)
    }

    setCheckpointState((prev) => {
      const next = prev.map((item) => item.id === checkpointId ? { ...item, completedAt: at, completedByQr: item.completedByQr ?? "manual" } : item)
      checkpointStateRef.current = next
      return next
    })

    const event: ScanEvent = { at, qrValue: "manual", type: "checkpoint_match", checkpointId: cp.id, checkpointName: cp.name, fraudFlag: "manual_validation" }
    setScanEvents((prev) => [event, ...prev].slice(0, 30))

    void (async () => {
      let sessionId = activeSessionIdRef.current
      if (!sessionId) {
        sessionId = await startRoundSessionRef.current(at)
      }
      if (sessionId) {
        await sendRoundEventForSessionRef.current(sessionId, event, "manual")
      }
    })()

    toast({
      title: startedAt ? "Checkpoint forzado" : "Ronda iniciada por L4",
      description: startedAt
        ? `${cp.name} validado manualmente mientras se sustituye el NFC.`
        : `${cp.name} arrancó la ronda por gestión manual L4 mientras se sustituye el NFC.`,
    })
  }

  const reopenCheckpointManual = (checkpointId: string) => {
    if (!canManualCheckpointValidation) {
      toast({ title: "Accion restringida", description: "Solo L4 puede reabrir checkpoints manualmente.", variant: "destructive" })
      return
    }
    if (!startedAt) {
      toast({ title: "Ronda no iniciada", description: "Primero inicie la ronda para ajustar checkpoints.", variant: "destructive" })
      return
    }

    const cp = checkpointStateRef.current.find((item) => item.id === checkpointId)
    if (!cp?.completedAt) return

    const at = nowIso()
    setCheckpointState((prev) => {
      const next = prev.map((item) => item.id === checkpointId ? { ...item, completedAt: null, completedByQr: null } : item)
      checkpointStateRef.current = next
      return next
    })

    const event: ScanEvent = { at, qrValue: "manual_revert", type: "checkpoint_reverted", checkpointId: cp.id, checkpointName: cp.name, fraudFlag: "manual_revert" }
    setScanEvents((prev) => [event, ...prev].slice(0, 30))
    if (activeSessionIdRef.current) {
      void sendRoundEventForSessionRef.current(activeSessionIdRef.current, event, "manual_revert")
    }

    toast({ title: "Checkpoint reabierto", description: `${cp.name} volvió a pendiente por gestión manual L4.` })
  }

  const openCheckpointCodeEditor = (checkpointId: string) => {
    if (!canManualCheckpointValidation) {
      toast({ title: "Accion restringida", description: "Solo L4 puede editar QR/NFC del checkpoint.", variant: "destructive" })
      return
    }
    if (!activeRound) return

    const checkpointIndex = checkpointStateRef.current.findIndex((item) => item.id === checkpointId)
    if (checkpointIndex < 0) return
    const checkpointDefinition = normalizeRoundCheckpoints(activeRound.checkpoints)[checkpointIndex]
    const checkpointStateItem = checkpointStateRef.current[checkpointIndex]

    setCheckpointCodeEditId(checkpointId)
    setCheckpointCodeEditName(checkpointStateItem?.name ?? checkpointDefinition?.name ?? `Punto ${checkpointIndex + 1}`)
    setCheckpointCodeEditQrText(joinCheckpointCodeInput([...(checkpointDefinition?.qrCodes ?? []), ...(checkpointDefinition?.qr_codes ?? []), ...(checkpointStateItem?.qrCodes ?? [])]))
    setCheckpointCodeEditNfcText(joinCheckpointCodeInput([...(checkpointDefinition?.nfcCodes ?? []), ...(checkpointDefinition?.nfc_codes ?? []), ...(checkpointStateItem?.nfcCodes ?? [])]))
    setCheckpointCodeEditOpen(true)
  }

  const handleSaveCheckpointCodeOverride = useCallback(async () => {
    if (!canManualCheckpointValidation || !activeRound) return
    const checkpointIndex = checkpointStateRef.current.findIndex((item) => item.id === checkpointCodeEditId)
    if (checkpointIndex < 0) return

    const nextQrCodes = splitCheckpointCodeInput(checkpointCodeEditQrText)
    const nextNfcCodes = splitCheckpointCodeInput(checkpointCodeEditNfcText)
    if (nextQrCodes.length === 0 && nextNfcCodes.length === 0) {
      toast({ title: "Codigos requeridos", description: "Ingrese al menos un QR o un NFC para ese checkpoint.", variant: "destructive" })
      return
    }

    const currentCheckpoints = normalizeRoundCheckpoints(activeRound.checkpoints)
    const nextCheckpoints = currentCheckpoints.map((checkpoint, index) => index === checkpointIndex ? {
      ...checkpoint,
      qrCodes: nextQrCodes,
      qr_codes: nextQrCodes,
      nfcCodes: nextNfcCodes,
      nfc_codes: nextNfcCodes,
    } : checkpoint)

    setCheckpointCodeEditSaving(true)
    const payload = toSnakeCaseKeys({ checkpoints: nextCheckpoints }) as Record<string, unknown>

    try {
      const response = await fetchInternalApi(supabase, "/api/rounds", {
        method: "PATCH",
        body: JSON.stringify({ id: String(activeRound.id ?? ""), ...payload }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      setCheckpointCodeEditSaving(false)

      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo actualizar el checkpoint."), variant: "destructive" })
        return
      }

      const roundId = String(activeRound.id ?? "").trim()
      setRoundCheckpointOverrides((current) => ({
        ...current,
        [roundId]: nextCheckpoints,
      }))
      setCheckpointState((prev) => {
        const next = prev.map((item, index) => index === checkpointIndex ? {
          ...item,
          qrCodes: nextQrCodes,
          nfcCodes: nextNfcCodes,
          scanCodes: Array.from(new Set([...nextQrCodes, ...nextNfcCodes])),
        } : item)
        checkpointStateRef.current = next
        return next
      })

      setCheckpointCodeEditOpen(false)
      toast({
        title: "Checkpoint actualizado",
        description: "El QR/NFC del checkpoint quedó actualizado y ya aplica en esta ronda.",
      })
      void reload(false)
    } catch {
      setCheckpointCodeEditSaving(false)
      toast({ title: "Error", description: "No se pudo actualizar el checkpoint.", variant: "destructive" })
    }
  }, [activeRound, canManualCheckpointValidation, checkpointCodeEditId, checkpointCodeEditNfcText, checkpointCodeEditQrText, reload, supabase, toast])

  const resetBulletin = () => {
    if (!activeRound) return
    stopNfcScan()
    const nextCheckpointState = buildCheckpointState(activeRound)
    checkpointStateRef.current = nextCheckpointState
    startedAtRef.current = null
    pendingStartByQrRef.current = false
    clearSessionId()
    setCheckpointState(nextCheckpointState)
    setScanEvents([])
    setStartedAt(null)
    setPendingStartByQr(false)
    setStartQrValidated(false)
    setBulletinContext(null)
    setNotes("")
    setPhotos([])
    setGpsTrack([])
    setDistanceMeters(0)
    setElapsedSeconds(0)
    setGpsError(null)
    latestGpsPointRef.current = null
    setPreRoundCondition("NORMAL")
    setPreRoundNotes("")
    setCheckDoorsClosed(true)
    setCheckLightsOk(true)
    setCheckPerimeterOk(true)
    setCheckNoStrangers(true)
  }

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) {
      e.target.value = ""
      return
    }

    if (!file.type.startsWith("image/")) {
      toast({ title: "Archivo no valido", description: "Seleccione una imagen para adjuntarla a la ronda.", variant: "destructive" })
      e.target.value = ""
      return
    }

    if (photos.length >= MAX_ROUND_PHOTOS) {
      toast({ title: "Limite de fotos", description: `La boleta permite hasta ${MAX_ROUND_PHOTOS} fotos para mantener guardado y sincronizacion estables.`, variant: "destructive" })
      e.target.value = ""
      return
    }

    try {
      const dataUrl = await optimizeImageFileToDataUrl(file, {
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.72,
        watermark: {
          label: "HO Seguridad | Ronda",
          capturedAt: nowIso(),
          gps: latestGpsPointRef.current,
          extraLines: [
            bulletinContext?.stationPostName || stationPostName || activeRound?.post || "Ronda operativa",
            bulletinContext?.roundName || activeRound?.name || "",
          ].filter(Boolean),
        },
      })

      setPhotos((prev) => {
        if (prev.length >= MAX_ROUND_PHOTOS) return prev
        return [...prev, dataUrl].filter(Boolean)
      })
    } catch {
      toast({ title: "Foto no disponible", description: "No se pudo procesar la imagen seleccionada.", variant: "destructive" })
    } finally {
      e.target.value = ""
    }
  }

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSaveBulletin = async () => {
    if (!activeRound || !startedAt) {
      toast({ title: "Boleta incompleta", description: "Seleccione ronda e inicie la boleta.", variant: "destructive" })
      return
    }

    if (stationModeEnabled && !activeOfficerName.trim()) {
      openShiftDialog()
      toast({ title: "Turno requerido", description: "Defina el oficial activo antes de cerrar la boleta.", variant: "destructive" })
      return
    }

    const endedAt = nowIso()
    const reportId = createRoundReportId()
    const status = completedCount === totalCount && totalCount > 0 ? "COMPLETA" : "PARCIAL"
    const alerts = computeRoundAlerts(gpsTrack, scanEvents, startedAt, endedAt, securityConfig)
    const context = bulletinContext ?? {
      stationLabel: String(stationLabel || stationPostName || activeRound.post || "").trim(),
      stationPostName: String(stationPostName || activeRound.post || "").trim(),
      officerName: actingOfficerName,
      roundId: String(activeRound.id ?? "").trim(),
      roundName: String(activeRound.name ?? "").trim(),
    }

    setSaving(true)
    try {
      const payload = {
        id: reportId,
        round_id: activeRound.id,
        round_name: context.roundName || String(activeRound.name ?? ""),
        post_name: stationModeEnabled ? (context.stationPostName || String(activeRound.post ?? "")) : String(activeRound.post ?? ""),
        officer_id: user?.uid ?? null,
        officer_name: context.officerName || actingOfficerName,
        started_at: startedAt,
        ended_at: endedAt,
        status,
        checkpoints_total: totalCount,
        checkpoints_completed: completedCount,
        checkpoint_logs: {
          checkpoints: checkpointState,
          events: scanEvents,
          photos,
          gps_track: gpsTrack,
          gps_distance_meters: Math.round(distanceMeters),
          elapsed_seconds: elapsedSeconds,
          pre_round: {
            condition: preRoundCondition,
            notes: preRoundNotes.trim() || null,
            checklist: {
              doorsClosed: checkDoorsClosed,
              lightsOk: checkLightsOk,
              perimeterOk: checkPerimeterOk,
              noStrangers: checkNoStrangers,
            },
          },
          shift_context: stationModeEnabled ? {
            station_label: context.stationLabel || context.stationPostName || String(activeRound.post ?? ""),
            station_post_name: context.stationPostName || String(activeRound.post ?? ""),
            active_officer_name: context.officerName || actingOfficerName,
            session_user_email: user?.email ?? null,
          } : null,
          alerts,
        },
        notes: notes.trim() || null,
        created_at: endedAt,
      }

      const response = await fetchInternalApi(supabase, "/api/round-reports", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const result = (await response.json().catch(() => null)) as { error?: string; warning?: string | null } | null
      if (!response.ok) {
        const rawError = String(result?.error ?? "")
        if (isRoundReportsMissingTableError(rawError)) {
          const contingencyResponse = await fetchInternalApi(supabase, "/api/supervisions", {
            method: "POST",
            body: JSON.stringify({
              operation_name: context.roundName || String(activeRound.name ?? "Ronda"),
              officer_name: context.officerName || actingOfficerName,
              review_post: stationModeEnabled ? (context.stationPostName || String(activeRound.post ?? "Puesto")) : String(activeRound.post ?? "Puesto"),
              supervisor_id: user?.email ?? user?.uid ?? null,
              status: status === "COMPLETA" ? "CUMPLIM" : "CON NOVEDAD",
              type: "BOLETA_RONDA",
              observations: [
                notes?.trim() ? `Boleta: ${notes.trim()}` : "Boleta de ronda registrada en modo contingencia.",
                `Pre-ronda: ${preRoundCondition}`,
                `Distancia: ${(distanceMeters / 1000).toFixed(2)} km`,
                `Duracion: ${formatDurationLabel(elapsedSeconds)}`,
                alerts.messages.length ? `Alertas: ${alerts.messages.join("; ")}` : "Alertas: Sin alertas criticas",
              ].join(" | "),
              photos,
              created_at: endedAt,
            }),
          })
          const contingency = (await contingencyResponse.json().catch(() => null)) as { error?: string; warning?: string | null } | null

          await finishRoundSession({
            endedAt,
            status,
            checkpointsCompleted: completedCount,
            checkpointsTotal: totalCount,
            notes: notes.trim() || null,
            reportId: null,
          })
          if (!contingencyResponse.ok) {
            toast({ title: "Error", description: contingency?.error || rawError, variant: "destructive" })
            return
          }

          toast({
            title: "Boleta guardada",
            description: "Guardada en modo contingencia. Falta crear tabla round_reports en la base de datos.",
          })
          if (contingency?.warning) {
            toast({ title: "Compatibilidad aplicada", description: String(contingency.warning), variant: "destructive" })
          }
          toast({
            title: "Pendiente de base de datos",
            description: "Ejecute supabase/create_round_reports.sql para habilitar historial de boletas nativo.",
            variant: "destructive",
          })
          resetBulletin()
          return
        }

        toast({ title: "Error", description: result?.error ?? "No se pudo cerrar la ronda.", variant: "destructive" })
        return
      }

      if (result?.warning) {
        toast({
          title: "Boleta guardada con compatibilidad",
          description: String(result.warning),
          variant: "destructive",
        })
      }

      await finishRoundSession({
        endedAt,
        status,
        checkpointsCompleted: completedCount,
        checkpointsTotal: totalCount,
        notes: notes.trim() || null,
        reportId,
      })

      if (!result?.warning) {
        toast({
          title: "Boleta guardada",
          description: `Boleta ${status.toLowerCase()} almacenada correctamente.`,
        })
      }

      void reload(false)

      resetBulletin()
    } catch {
      toast({ title: "Error", description: "No se pudo cerrar la ronda. Intente de nuevo.", variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (!startedAt) return

    const tick = window.setInterval(() => {
      const base = new Date(startedAt).getTime()
      if (Number.isNaN(base)) return
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - base) / 1000)))
    }, 1000)

    if (!("geolocation" in navigator)) return () => window.clearInterval(tick)

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point: GpsPoint = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          speed: typeof position.coords.speed === "number" ? position.coords.speed : null,
          recordedAt: nowIso(),
          ts: Date.now(),
        }
        setGpsError(null)
        latestGpsPointRef.current = point
        setGpsTrack((prev) => {
          const last = prev[prev.length - 1]
          if (last) {
            const step = haversineDistanceMeters(last, point)
            if (step < 2) return prev
            setDistanceMeters((d) => d + step)
          }
          return [...prev, point].slice(-2400)
        })
      },
      (err) => {
        setGpsError(err.message || "No se pudo obtener la ubicacion.")
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 15000,
      }
    )

    return () => {
      window.clearInterval(tick)
      if (gpsWatchIdRef.current != null) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current)
        gpsWatchIdRef.current = null
      }
    }
  }, [startedAt])

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">BOLETA DE RONDA</h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Ejecucion independiente de rondas por escaneo QR/NFC de checkpoints.
          </p>
          {isL1Operator ? (
            <p className="text-[10px] uppercase font-black tracking-wide text-cyan-300">Modo rapido L1 activo</p>
          ) : null}
        </div>
        {canManageRoundDefinitions ? (
          <Button asChild className="h-10 bg-primary text-black font-black uppercase gap-2">
            <Link href="/rounds/new">
              <Plus className="w-4 h-4" /> Nueva ronda
            </Link>
          </Button>
        ) : null}
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Nueva boleta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isL1Operator ? (
            <div className="rounded border border-cyan-400/30 bg-gradient-to-br from-cyan-500/15 via-cyan-400/10 to-transparent p-4 space-y-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-black tracking-[0.2em] text-cyan-200">Modo turno</p>
                  <p className="text-2xl font-black uppercase text-white">Operacion enfocada en tu puesto</p>
                  <p className="text-[11px] uppercase text-white/70">Cobertura: {l1CoverageLabel}</p>
                  {l1ScopeTokens.length === 0 ? <p className="text-[10px] uppercase font-black text-amber-300">Falta contexto operativo del puesto para cargar rondas L1.</p> : null}
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-right">
                  <p className="text-[10px] uppercase font-black text-white/50">Siguiente vencimiento</p>
                  <p className="text-sm font-black uppercase text-white">
                    {l1TurnSummary.nextDueRound
                      ? `${l1TurnSummary.nextDueRound.name} ${new Date(l1TurnSummary.nextDueRound.dueAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Sin referencia"}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
                <div className="rounded border border-red-400/20 bg-red-500/10 p-3">
                  <p className="text-[10px] uppercase font-black text-red-200">Vencidas</p>
                  <p className="text-2xl font-black text-white">{l1TurnSummary.overdue}</p>
                </div>
                <div className="rounded border border-amber-300/20 bg-amber-400/10 p-3">
                  <p className="text-[10px] uppercase font-black text-amber-100">Por vencer</p>
                  <p className="text-2xl font-black text-white">{l1TurnSummary.dueSoon}</p>
                </div>
                <div className="rounded border border-cyan-300/20 bg-cyan-400/10 p-3">
                  <p className="text-[10px] uppercase font-black text-cyan-100">En curso</p>
                  <p className="text-2xl font-black text-white">{l1TurnSummary.inProgress}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/60">Pendientes</p>
                  <p className="text-2xl font-black text-white">{l1TurnSummary.pending}</p>
                </div>
              </div>

              <div className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Secuencia operativa</p>
                <p className="text-[11px] uppercase text-white/75">1 Seleccione su ronda  2 Acerque NFC del primer punto  3 Complete checkpoints  4 Cierre sin salir de esta pantalla</p>
              </div>
            </div>
          ) : null}

          {roleLevel >= 3 ? (
            <div className="rounded border border-emerald-400/20 bg-emerald-500/10 p-4 space-y-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-black tracking-[0.2em] text-emerald-200">Rondas en curso</p>
                  <p className="text-sm font-black uppercase text-white">Visibilidad operativa en tiempo real</p>
                  <p className="text-[11px] uppercase text-white/65">Sesiones activas que caen dentro de su alcance actual.</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 px-3 py-2 text-right">
                  <p className="text-[10px] uppercase font-black text-white/50">Activas visibles</p>
                  <p className="text-2xl font-black text-white">{activeRoundSessions.length}</p>
                </div>
              </div>

              {activeRoundSessions.length === 0 ? (
                <p className="text-[11px] uppercase text-white/65">No hay rondas en curso visibles con su alcance actual.</p>
              ) : (
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                  {activeRoundSessions.slice(0, 6).map((session) => {
                    const linkedRound = roundsWithCheckpointOverrides.find((round) => (
                      String(round.id) === getRoundSessionRoundId(session)
                      || String(round.name ?? "").trim().toLowerCase() === getRoundSessionRoundName(session).trim().toLowerCase()
                    )) ?? null
                    const startedLabel = getRoundSessionStartedDate(session)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "-"
                    const lastScanLabel = getRoundSessionLastScanDate(session)?.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) ?? "Sin escaneo"

                    return (
                      <button
                        key={session.id}
                        type="button"
                        onClick={() => {
                          if (linkedRound?.id) handleRoundChange(String(linkedRound.id))
                        }}
                        disabled={!linkedRound?.id}
                        className="rounded border border-white/10 bg-black/25 p-3 text-left transition hover:border-emerald-300/40 hover:bg-black/35 disabled:cursor-default disabled:opacity-80"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <p className="text-[11px] font-black uppercase text-white">{getRoundSessionRoundName(session) || String(linkedRound?.name ?? "Ronda activa")}</p>
                            <p className="text-[10px] uppercase text-white/55">{getRoundSessionPostName(session) || String(linkedRound?.post ?? "Puesto")}</p>
                          </div>
                          <span className="rounded border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-200">
                            {getRoundSessionProgressLabel(session)}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] uppercase text-white/60">
                          <p>Oficial: <span className="text-white">{getRoundSessionOfficerName(session)}</span></p>
                          <p>Inicio: <span className="text-white">{startedLabel}</span></p>
                          <p>Último punto: <span className="text-white">{lastScanLabel}</span></p>
                          <p>Estado: <span className="text-emerald-200">En curso</span></p>
                        </div>

                        <div className="mt-3 flex items-center justify-between text-[10px] font-black uppercase">
                          <span className="text-white/55">Seguimiento L3/L4</span>
                          <span className={linkedRound?.id ? "text-emerald-200" : "text-white/35"}>{linkedRound?.id ? "Abrir ronda" : "Sin definición local"}</span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : null}

          {canEditFraudConfig && (
            <div className="rounded border border-cyan-500/30 bg-cyan-500/10 p-3 space-y-3">
              <p className="text-[10px] font-black uppercase text-cyan-200">Config geofencing y antifraude (L4)</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Radio geofence (m)</Label>
                  <Input
                    type="number"
                    min={20}
                    max={300}
                    value={geofenceRadiusMeters}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setGeofenceRadiusMeters(Math.max(20, Math.min(300, Number(e.target.value || 50))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Brecha sin QR/NFC (min)</Label>
                  <Input
                    type="number"
                    min={3}
                    max={30}
                    value={noScanGapMinutes}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setNoScanGapMinutes(Math.max(3, Math.min(30, Number(e.target.value || 10))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Salto GPS (m)</Label>
                  <Input
                    type="number"
                    min={60}
                    max={500}
                    value={maxJumpMeters}
                    disabled={!canEditFraudConfig}
                    onChange={(e) => setMaxJumpMeters(Math.max(60, Math.min(500, Number(e.target.value || 120))))}
                    className="h-9 bg-black/30 border-white/10 text-white"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  className="h-8 bg-primary text-black font-black uppercase"
                  onClick={() => void handleSaveSecurityConfig()}
                  disabled={isSavingSecurityConfig}
                >
                  {isSavingSecurityConfig ? "Guardando..." : "Guardar config global"}
                </Button>
                <span className="text-[10px] text-cyan-100/80 uppercase">
                  Fuente activa: {serverSecurityConfig ? "Servidor" : "Local"}
                </span>
              </div>
              {securityConfigError ? (
                <p className="text-[10px] text-amber-200 uppercase">Config servidor no disponible: usando valores locales.</p>
              ) : null}
              {recentFraudNotifications.length > 0 ? (
                <div className="rounded border border-red-500/30 bg-red-500/10 p-2">
                  <p className="text-[10px] font-black uppercase text-red-200 mb-1">Notificaciones antifraude recientes</p>
                  <div className="space-y-1">
                    {recentFraudNotifications.map((n) => (
                      <p key={n.id} className="text-[10px] text-red-100">
                        [{n.at?.toLocaleString?.() ?? "-"}] {n.roundName} / {n.officerName}: {n.messages[0]}
                      </p>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-[10px] text-cyan-100/80 uppercase">Sin alertas antifraude recientes.</p>
              )}
            </div>
          )}

          <input
            id="round-photo-camera-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePhotoFile}
          />

          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto_auto] gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">{isL1Operator ? "Ronda del turno" : "Ronda"}</Label>
              <Select value={activeRoundId} onValueChange={handleRoundChange}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccione una ronda" /></SelectTrigger>
                <SelectContent>
                  {prioritizedRounds.map((round) => (
                    <SelectItem key={round.id} value={String(round.id)}>
                      {String(round.name ?? "Ronda")} - {String(round.post ?? "Puesto")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button type="button" onClick={handleStartBulletin} className="h-10 bg-primary text-black font-black uppercase" disabled={!activeRound || !!startedAt || pendingStartByQr}>
              {pendingStartByQr ? "Esperando punto..." : nfcSupported ? "Iniciar NFC" : isL1Operator ? "Inicio rapido" : "Iniciar QR"}
            </Button>
            <Button type="button" variant="outline" onClick={() => handleQrOpenChange(true)} className="h-10 border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2">
              <QrCode className="w-4 h-4" /> QR
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!startedAt && !pendingStartByQr) {
                  handleStartBulletin()
                  return
                }
                void startNfcScan()
              }}
              className="h-10 border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2"
              disabled={!nfcSupported || isNfcScanning}
            >
              <ScanLine className="w-4 h-4" /> {isNfcScanning ? "NFC activo" : "NFC"}
            </Button>
            <Button type="button" variant="ghost" onClick={resetBulletin} className="h-10 font-black uppercase text-white/70 hover:text-white">
              Limpiar
            </Button>
            {pendingStartByQr ? (
              <Button type="button" variant="ghost" onClick={resetStartAttempt} className="h-10 font-black uppercase text-amber-200 hover:text-white">
                Reintentar inicio
              </Button>
            ) : null}
          </div>

          {isL1Operator ? (
            <div className="rounded border border-cyan-400/30 bg-cyan-500/10 p-4 space-y-4">
              <div className="space-y-2">
                <p className="text-[10px] uppercase font-black tracking-[0.2em] text-cyan-200">Mis rondas</p>
                <div className="flex flex-wrap gap-2">
                  {prioritizedRounds.slice(0, 6).map((round) => {
                    const isActive = String(round.id) === activeRoundId
                    return (
                      <Button
                        key={String(round.id)}
                        type="button"
                        variant="outline"
                        onClick={() => handleRoundChange(String(round.id))}
                        className={isActive
                          ? "h-9 border-cyan-300/50 bg-cyan-400/20 text-white font-black uppercase text-[10px]"
                          : "h-9 border-white/20 text-white hover:bg-white/10 font-black uppercase text-[10px]"
                        }
                      >
                        {String(round.name ?? "Ronda")}
                      </Button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                  {l1RoundTray.map((round) => (
                    <button
                      key={`tray-${round.id}`}
                      type="button"
                      onClick={() => handleRoundChange(round.id)}
                      className="rounded border border-white/10 bg-black/20 p-3 text-left hover:bg-white/5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-[11px] font-black uppercase text-white">{round.name}</p>
                          <p className="text-[10px] uppercase text-white/50">{round.post}</p>
                        </div>
                        <span className={`text-[9px] font-black uppercase ${round.status === "EN CURSO" ? "text-cyan-300" : round.status === "VENCIDA" ? "text-red-300" : round.status === "POR VENCER" ? "text-amber-300" : "text-white/60"}`}>
                          {round.status}
                        </span>
                      </div>
                      <p className="mt-2 text-[10px] uppercase text-white/50">
                        Frecuencia {round.frequencyMinutes} min{round.lastReportAt ? ` | Ultima ${round.lastReportAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : " | Sin boleta hoy"}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="text-[10px] uppercase font-black tracking-[0.2em] text-cyan-200">Modo operativo NFC</p>
                  <p className="text-xl font-black uppercase text-white">{activeRound ? String(activeRound.name ?? "Ronda") : "Seleccione una ronda"}</p>
                  <p className="text-[11px] uppercase text-white/70">{activeRound ? String(activeRound.post ?? "Puesto") : "Sin ronda cargada"}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-black text-white/50">Progreso</p>
                  <p className="text-2xl font-black text-white">{completedCount}/{totalCount}</p>
                </div>
              </div>

              <div className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Estado actual</p>
                <p className="text-lg font-black uppercase text-white">{operationalStatusLabel}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  type="button"
                  onClick={() => {
                    if (!startedAt && !pendingStartByQr) {
                      handleStartBulletin()
                      return
                    }
                    void startNfcScan()
                  }}
                  className="h-14 bg-primary text-black font-black uppercase text-base"
                  disabled={!activeRound}
                >
                  <ScanLine className="w-5 h-5 mr-2" /> {startedAt || pendingStartByQr ? "Acercar NFC" : "Iniciar con NFC"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleQrOpenChange(true)}
                  className="h-14 border-white/20 text-white hover:bg-white/10 font-black uppercase text-base"
                  disabled={!activeRound}
                >
                  <QrCode className="w-5 h-5 mr-2" /> Usar QR
                </Button>
              </div>

              {startedAt ? (
                <Button
                  type="button"
                  onClick={() => void handleSaveBulletin()}
                  disabled={!activeRound || saving}
                  className="h-12 w-full bg-emerald-300 text-black font-black uppercase"
                >
                  {saving ? "Cerrando..." : completedCount === totalCount && totalCount > 0 ? "Finalizar ronda completa" : "Cerrar ronda parcial"}
                </Button>
              ) : null}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setQuickIncidentOpen(true)}
                  className="h-11 border-amber-300/40 text-amber-100 hover:bg-amber-400/10 font-black uppercase"
                  disabled={!activeRound}
                >
                  Reportar novedad
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11 border-white/20 text-white hover:bg-white/10 font-black uppercase"
                >
                  <label htmlFor="round-photo-camera-input" aria-disabled={!activeRound} className={!activeRound ? "pointer-events-none opacity-50" : undefined}>
                    Agregar foto
                  </label>
                </Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Tiempo</p>
                  <p className="text-sm font-black text-white">{formatDurationLabel(elapsedSeconds)}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Ultimo punto</p>
                    <p className="text-sm font-black text-white">{(() => {
                      const completedCheckpoints = checkpointState.filter((cp) => cp.completedAt)
                      return completedCheckpoints[completedCheckpoints.length - 1]?.name ?? "Ninguno"
                    })()}</p>
                </div>
                <div className="rounded border border-white/10 bg-black/20 p-3">
                  <p className="text-[10px] uppercase font-black text-white/50">Siguiente punto</p>
                  <p className="text-sm font-black text-white">{nextPendingCheckpoint?.name ?? "Completa"}</p>
                </div>
              </div>
            </div>
          ) : null}

          {canManageRoundDefinitions ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="h-8 border-white/20 text-amber-200 hover:bg-white/10 text-[10px] font-black uppercase"
                onClick={() => handleOpenRoundDefinitionEdit(activeRound)}
                disabled={!activeRound || !!startedAt || pendingStartByQr}
              >
                Editar ronda
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-8 border-red-500/40 text-red-300 hover:bg-red-500/10 text-[10px] font-black uppercase"
                onClick={() => void handleDeleteRoundDefinition(activeRound)}
                disabled={!activeRound || !!startedAt || pendingStartByQr || deletingRoundId === String(activeRound?.id ?? "")}
              >
                {deletingRoundId === String(activeRound?.id ?? "") ? "Eliminando..." : "Eliminar ronda"}
              </Button>
            </div>
          ) : null}

          {!nfcSupported ? (
            <p className="text-[10px] text-amber-300 uppercase">NFC web no disponible en este dispositivo/navegador.</p>
          ) : null}

          {nfcSupported && isStandalonePwa ? (
            <p className="text-[10px] text-amber-300 uppercase">NFC en celular: use Chrome normal, no la app instalada. En modo app/PWA el inicio y lectura NFC pueden fallar.</p>
          ) : null}

          <div className="rounded border border-white/10 bg-black/30 p-3 space-y-3">
            <p className="text-[10px] font-black uppercase text-white/70">Pre-ronda: estado del lugar</p>
            {isL1Operator ? (
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-black text-white/70">Observacion inicial opcional</Label>
                <Input
                  value={preRoundNotes}
                  onChange={(e) => setPreRoundNotes(e.target.value)}
                  placeholder="Solo si hay novedad visible al iniciar"
                  className="h-10 bg-black/30 border-white/10 text-white"
                />
                <p className="text-[10px] text-white/50 uppercase">Modo L1: condicion general queda en normal para iniciar mas rapido.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Condicion general</Label>
                  <Select value={preRoundCondition} onValueChange={setPreRoundCondition}>
                    <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Estado general" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NORMAL">Normal</SelectItem>
                      <SelectItem value="NOVEDAD">Con novedad</SelectItem>
                      <SelectItem value="RIESGO">Riesgo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Observacion inicial</Label>
                  <Input
                    value={preRoundNotes}
                    onChange={(e) => setPreRoundNotes(e.target.value)}
                    placeholder="Estado del puesto al iniciar"
                    className="h-10 bg-black/30 border-white/10 text-white"
                  />
                </div>
              </div>
            )}
            {!isL1Operator ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkDoorsClosed} onChange={(e) => setCheckDoorsClosed(e.target.checked)} /> Puertas cerradas</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkLightsOk} onChange={(e) => setCheckLightsOk(e.target.checked)} /> Luces y alarmas OK</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkPerimeterOk} onChange={(e) => setCheckPerimeterOk(e.target.checked)} /> Perimetro sin riesgo</label>
                <label className="flex items-center gap-2 text-[10px] font-bold uppercase text-white/70"><input type="checkbox" checked={checkNoStrangers} onChange={(e) => setCheckNoStrangers(e.target.checked)} /> Sin personas extranas</label>
              </div>
            ) : (
              <p className="text-[10px] text-white/50 uppercase">Checklist rapido autoasumido en OK para acelerar ronda L1.</p>
            )}
          </div>

          {!isL1Operator ? (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Estado inicio</p>
                <p className="text-sm font-black text-white">{startQrValidated ? "Validado" : pendingStartByQr ? (nfcSupported ? "Pendiente NFC" : "Pendiente QR") : "No iniciado"}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Tiempo</p>
                <p className="text-sm font-black text-white">{formatDurationLabel(elapsedSeconds)}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Distancia</p>
                <p className="text-sm font-black text-white">{distanceKm.toFixed(2)} km</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-3">
                <p className="text-[10px] uppercase font-black text-white/50">Puntos GPS</p>
                <p className="text-sm font-black text-white">{gpsTrack.length}</p>
              </div>
            </div>
          ) : null}

          {!isL1Operator ? (
            <div className="rounded border border-white/10 bg-black/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] uppercase font-black text-white/60">Trazado de ruta (GPS)</p>
                {gpsError ? <span className="text-[10px] uppercase font-bold text-amber-300">{gpsError}</span> : null}
              </div>
              <div className="h-[150px] rounded border border-white/10 bg-black/50 flex items-center justify-center overflow-hidden">
                {trackPath ? (
                  <svg width="100%" height="100%" viewBox="0 0 340 140" preserveAspectRatio="none">
                    <path d={trackPath} stroke="#22d3ee" strokeWidth="2" fill="none" />
                  </svg>
                ) : (
                  <p className="text-[10px] text-white/50 uppercase">Inicie la ronda para ver el trazado</p>
                )}
              </div>
              {latestGpsPoint ? (
                <p className="text-[10px] text-white/50 uppercase">
                  Ultimo GPS: {latestGpsPoint.lat.toFixed(5)}, {latestGpsPoint.lng.toFixed(5)} | acc {Math.round(latestGpsPoint.accuracy)}m
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-white/70">
              <span>Avance checkpoints</span>
              <span>{completedCount}/{totalCount}</span>
            </div>
            <Progress value={progress} className="h-3 bg-white/10" />
            {canManualCheckpointValidation ? (
              <p className="text-[10px] uppercase font-bold tracking-wide text-cyan-200">
                Gestión L4: puede iniciar manualmente, forzar checkpoint o reabrirlo mientras se sustituye el NFC.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4">
            <div className="space-y-2">
              {roundsLoading ? (
                <div className="h-28 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : checkpointState.length === 0 ? (
                <div className="rounded border border-white/10 p-4 text-[11px] text-white/60">Seleccione una ronda para cargar checkpoints.</div>
              ) : (
                checkpointState.map((cp) => {
                  const isNextPending = !cp.completedAt && nextPendingCheckpoint?.id === cp.id
                  return (
                  <div key={cp.id} className={`rounded border p-3 flex items-center justify-between gap-3 ${isNextPending ? "border-cyan-300/40 bg-cyan-500/10" : "border-white/10 bg-black/30"}`}>
                    <div>
                      <p className="text-[11px] font-black uppercase text-white">{cp.name}</p>
                      <p className="text-[10px] text-white/50">
                        {isNextPending ? "Siguiente punto" : `QR: ${cp.qrCodes.length || 0} | NFC: ${cp.nfcCodes.length || 0}`}
                        {cp.completedByQr ? ` | Validado por: ${cp.completedByQr}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {cp.completedAt ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-green-400">
                            <CheckCircle2 className="w-4 h-4" /> OK
                          </span>
                          {canManualCheckpointValidation ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-cyan-300/30 text-cyan-100 text-[9px] uppercase"
                              onClick={() => reopenCheckpointManual(cp.id)}
                            >
                              Reabrir
                            </Button>
                          ) : null}
                          {canManualCheckpointValidation ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-white/20 text-white text-[9px] uppercase"
                              onClick={() => openCheckpointCodeEditor(cp.id)}
                            >
                              Editar NFC/QR
                            </Button>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase text-amber-300">
                            <Circle className="w-3 h-3" /> Pendiente
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 border-white/20 text-white text-[9px] uppercase"
                            onClick={() => markCheckpointManual(cp.id)}
                            disabled={!canManualCheckpointValidation}
                          >
                            {canManualCheckpointValidation ? (startedAt ? "Forzar L4" : "Iniciar L4") : "Manual L4"}
                          </Button>
                          {canManualCheckpointValidation ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 border-white/20 text-white text-[9px] uppercase"
                              onClick={() => openCheckpointCodeEditor(cp.id)}
                            >
                              Editar NFC/QR
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>
                )})
              )}

              <div className="space-y-1 pt-2">
                <Label className="text-[10px] uppercase font-black text-white/70">Observaciones boleta</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="bg-black/30 border-white/10 min-h-[90px]" placeholder="Novedades o comentarios de la ronda..." />
              </div>

              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between gap-3">
                  <Label className="text-[10px] uppercase font-black text-white/70">Evidencia fotografica ({photos.length}/{MAX_ROUND_PHOTOS})</Label>
                  <Button asChild variant="outline" className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase gap-1">
                    <label htmlFor="round-photo-camera-input">
                      <Camera className="w-3.5 h-3.5" /> Agregar foto
                    </label>
                  </Button>
                </div>
                <p className="text-[10px] text-white/45 uppercase">Maximo {MAX_ROUND_PHOTOS} fotos por boleta para evitar fallas de guardado en celular.</p>
                {photos.length === 0 ? (
                  <p className="text-[10px] text-white/50">Sin fotos adjuntas por ahora.</p>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {photos.map((photo, i) => (
                      <div key={`${photo.slice(0, 24)}-${i}`} className="relative aspect-square rounded overflow-hidden border border-white/10">
                        <Image src={photo} alt={`Evidencia ${i + 1}`} fill unoptimized sizes="(max-width: 640px) 33vw, 10vw" className="object-cover" />
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute top-1 right-1 bg-black/70 border border-white/20 rounded p-1 text-white hover:bg-red-700/80"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <Button type="button" onClick={handleSaveBulletin} disabled={!activeRound || !startedAt || saving} className="w-full h-11 bg-primary text-black font-black uppercase gap-2 disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />} Guardar boleta
              </Button>
            </div>

            {!isL1Operator ? (
              <Card className="bg-black/30 border-white/10">
                <CardHeader className="pb-2">
                  <CardTitle className="text-[11px] font-black uppercase text-white">Eventos QR</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 max-h-[430px] overflow-y-auto">
                  {scanEvents.length === 0 ? (
                    <p className="text-[10px] text-white/50">Sin eventos por ahora.</p>
                  ) : (
                    scanEvents.map((event, index) => (
                      <div key={`${event.at}-${index}`} className="rounded border border-white/10 p-2 text-[10px] bg-black/40">
                        <p className="font-black uppercase text-white/80">{event.type.replaceAll("_", " ")}</p>
                        <p className="text-white/60">{event.checkpointName ?? "-"}</p>
                        <p className="text-white/50 font-mono break-all">{event.qrValue}</p>
                        {(typeof event.lat === "number" && typeof event.lng === "number") ? (
                          <p className="text-white/40 font-mono">GPS {event.lat.toFixed(5)}, {event.lng.toFixed(5)}{typeof event.accuracy === "number" ? ` | acc ${Math.round(event.accuracy)}m` : ""}</p>
                        ) : null}
                        {typeof event.geofenceDistanceMeters === "number" ? (
                          <p className={event.geofenceInside === false ? "text-red-300 font-mono" : "text-emerald-300 font-mono"}>
                            Geofence: {event.geofenceDistanceMeters}m / radio {geofenceRadiusMeters}m
                          </p>
                        ) : null}
                        {event.fraudFlag ? (
                          <p className="text-red-300 font-bold uppercase">Alerta: {event.fraudFlag.replaceAll("_", " ")}</p>
                        ) : null}
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">{isL1Operator ? "Mis boletas" : "Historial de boletas"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-7 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Fecha desde</Label>
              <Input
                type="date"
                value={historyDateFromFilter}
                onChange={(e) => setHistoryDateFromFilter(e.target.value)}
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Fecha hasta</Label>
              <Input
                type="date"
                value={historyDateToFilter}
                onChange={(e) => setHistoryDateToFilter(e.target.value)}
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Hora (HH:mm)</Label>
              <Input
                value={historyHourFilter}
                onChange={(e) => setHistoryHourFilter(e.target.value)}
                placeholder="14:30"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Operacion</Label>
              <Input
                value={historyOperationFilter}
                onChange={(e) => setHistoryOperationFilter(e.target.value)}
                placeholder="Ronda Norte"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Lugar</Label>
              <Input
                value={historyLocationFilter}
                onChange={(e) => setHistoryLocationFilter(e.target.value)}
                placeholder="Puesto / Posta"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Supervisor</Label>
              <Input
                value={historySupervisorFilter}
                onChange={(e) => setHistorySupervisorFilter(e.target.value)}
                placeholder="Nombre o correo"
                className="h-9 bg-black/30 border-white/10 text-white"
              />
            </div>
            <div className="space-y-1 flex items-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 w-full border-white/20 text-white hover:bg-white/10 font-black uppercase"
                onClick={() => {
                  setHistoryDateFromFilter("")
                  setHistoryDateToFilter("")
                  setHistoryHourFilter("")
                  setHistoryOperationFilter("")
                  setHistoryLocationFilter("")
                  setHistorySupervisorFilter("")
                }}
              >
                Limpiar filtros
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] uppercase font-black text-white/50">Rango rapido:</span>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(1)}
            >
              Hoy
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(7)}
            >
              7 dias
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-7 px-3 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
              onClick={() => applyQuickRange(30)}
            >
              30 dias
            </Button>
          </div>

          <p className="text-[10px] text-white/50 uppercase font-bold tracking-wide">
            Mostrando {filteredReports.length} de {effectiveScopedReports.length} boletas
          </p>

          {(queuedRoundReports.length > 0 || queuedRoundSessionSummary.total > 0) ? (
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded border border-amber-400/20 bg-amber-400/10 p-3">
                <div className="flex items-center gap-2 text-amber-200">
                  <WifiOff className="h-4 w-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Boletas offline</p>
                </div>
                <p className="mt-2 text-2xl font-black text-white">{queuedRoundReports.length}</p>
                <p className="mt-2 text-[11px] leading-5 text-white/75">
                  Si este contador es mayor a cero, la boleta no subió y sigue solo en este navegador por falla de conectividad o fetch al guardar.
                </p>
                {queuedRoundReports[0]?.offlineLastError ? (
                  <p className="mt-2 text-[11px] text-amber-100">
                    Último error: {normalizeOfflineError(queuedRoundReports[0].offlineLastError)}
                  </p>
                ) : null}
              </div>
              <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-3">
                <div className="flex items-center gap-2 text-cyan-200">
                  <AlertTriangle className="h-4 w-4" />
                  <p className="text-[10px] font-black uppercase tracking-widest">Sesión start/event/finish</p>
                </div>
                <p className="mt-2 text-2xl font-black text-white">{queuedRoundSessionSummary.total}</p>
                <p className="mt-2 text-[11px] leading-5 text-white/75">
                  Start: {queuedRoundSessionSummary.counts.start} · Event: {queuedRoundSessionSummary.counts.event} · Finish: {queuedRoundSessionSummary.counts.finish}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-white/75">
                  Si aquí hay pendientes, el problema no es solo la boleta: la sesión operativa también quedó en cola local.
                </p>
                {queuedRoundSessionSummary.lastError ? (
                  <p className="mt-2 text-[11px] text-cyan-100">
                    Último error: {normalizeOfflineError(queuedRoundSessionSummary.lastError)}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          {reportsLoading ? (
            <div className="h-24 flex items-center justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : effectiveScopedReports.length === 0 ? (
            <p className="text-[11px] text-white/60">Sin boletas registradas.</p>
          ) : filteredReports.length === 0 ? (
            <p className="text-[11px] text-white/60">No hay boletas que coincidan con los filtros.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="border-b border-white/10">
                  <tr>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Fecha</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Hora</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Ronda</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Lugar</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Oficial</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Supervisor</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Avance</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Estado</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Alertas</th>
                    <th className="py-2 text-[10px] font-black uppercase text-white/60">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReports.map((r) => {
                    const safeDate = getReportCreatedDate(r)
                    const alertMessages = getStoredAlertMessages(r)
                    const reportTrack = getReportTrack(r)
                    const sessionKinds = r.offlineSessionKinds ?? []
                    const exactSyncError = r.offlineSessionLastError || r.offlineLastError || null
                    return (
                    <tr key={r.id} className="border-b border-white/5">
                      <td className="py-2 text-[10px] text-white/70">{safeDate?.toLocaleDateString?.() ?? "-"}</td>
                      <td className="py-2 text-[10px] text-white/70">{safeDate?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-"}</td>
                      <td className="py-2 text-[10px] text-white">
                        <div className="space-y-1">
                          <p>{getReportRoundName(r) || "-"}</p>
                          {r.localOnly ? (
                            <div className="flex flex-wrap gap-1">
                              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-200">Local</span>
                              <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-white/70">{r.offlineSyncCause || "Pendiente"}</span>
                              {sessionKinds.length > 0 ? (
                                <span className="rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-cyan-100">Sesión {formatOfflineSessionKinds(sessionKinds)}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 text-[10px] text-white/70">{getReportPostName(r) || "-"}</td>
                      <td className="py-2 text-[10px] text-white/70">{getReportOfficerName(r) || "-"}</td>
                      <td className="py-2 text-[10px] text-white/70">{getReportSupervisorName(r) || "-"}</td>
                      <td className="py-2 text-[10px] text-white/70">{getReportProgressLabel(r)}</td>
                      <td className="py-2 text-[10px] font-black">
                        <div className="space-y-1">
                          <span className={String(r.status ?? "").toUpperCase() === "COMPLETA" ? "text-green-400" : "text-amber-300"}>
                            {String(r.status ?? "-")}
                          </span>
                          {r.localOnly ? (
                            <p className="max-w-[220px] text-[9px] font-medium leading-4 text-white/55">
                              {exactSyncError ? `Error exacto: ${normalizeOfflineError(exactSyncError)}` : "Pendiente local sin detalle adicional."}
                            </p>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 text-[10px] text-white/70">{alertMessages.length}</td>
                      <td className="py-2 text-[10px]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => handleOpenRoundDetail(r)}
                          >
                            Info
                          </Button>
                          {canGenerateAiSummary ? null : null}
                          {canEditRoundReports ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 border-white/20 text-amber-200 hover:bg-white/10 text-[9px] font-black uppercase"
                              onClick={() => handleOpenRoundEdit(r)}
                            >
                              Editar
                            </Button>
                          ) : null}
                          {canEditRoundReports ? (
                            <Button
                              type="button"
                              variant="outline"
                              className="h-7 px-2 border-red-500/40 text-red-300 hover:bg-red-500/10 text-[9px] font-black uppercase"
                              disabled={deletingHistoryReportId === String(r.id)}
                              onClick={() => void handleDeleteRoundReport(r)}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              {deletingHistoryReportId === String(r.id) ? "Eliminando" : "Eliminar"}
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            disabled={reportTrack.length < 2}
                            onClick={() => {
                              setHistoryTrackReport(r)
                              setHistoryTrackOpen(true)
                            }}
                          >
                            Ruta
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-emerald-200 hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => void handleExportSingleExcel(r)}
                          >
                            <FileSpreadsheet className="w-3 h-3 mr-1" /> Excel
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-cyan-100 hover:bg-white/10 text-[9px] font-black uppercase"
                            onClick={() => void handleExportSinglePdf(r)}
                          >
                            <FileDown className="w-3 h-3 mr-1" /> PDF
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-7 px-2 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                            disabled={reportTrack.length < 2}
                            onClick={() => downloadGpxFromReport(r)}
                          >
                            <Download className="w-3 h-3 mr-1" /> GPX
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <QrScannerDialog
        open={qrOpen}
        onOpenChange={handleQrOpenChange}
        pendingStartByQr={pendingStartByQr}
        videoRef={videoRef}
        isScanning={isScanning}
        scanError={scanError}
        qrSupported={qrSupported}
        canManualCheckpointValidation={canManualCheckpointValidation}
        qrInput={qrInput}
        onQrInputChange={setQrInput}
        onApplyManual={() => { if (qrInput.trim()) applyScannedValue(qrInput) }}
      />

      <CheckpointCodeEditorDialog
        open={checkpointCodeEditOpen}
        onOpenChange={setCheckpointCodeEditOpen}
        name={checkpointCodeEditName}
        qrText={checkpointCodeEditQrText}
        onQrTextChange={setCheckpointCodeEditQrText}
        nfcText={checkpointCodeEditNfcText}
        onNfcTextChange={setCheckpointCodeEditNfcText}
        saving={checkpointCodeEditSaving}
        onSave={() => void handleSaveCheckpointCodeOverride()}
      />

      <QuickIncidentDialog
        open={quickIncidentOpen}
        onOpenChange={handleQuickIncidentDialogChange}
        location={quickIncidentLocation}
        type={quickIncidentType}
        onTypeChange={setQuickIncidentType}
        description={quickIncidentDescription}
        onDescriptionChange={setQuickIncidentDescription}
        saving={savingQuickIncident}
        onSave={() => void handleSaveQuickIncident()}
      />

      {isL1Operator && (startedAt || pendingStartByQr) ? (
        <Button
          type="button"
          onClick={() => handleQrOpenChange(true)}
          className="fixed bottom-6 right-6 z-50 h-12 w-12 rounded-full bg-primary text-black shadow-xl"
        >
          <QrCode className="w-5 h-5" />
        </Button>
      ) : null}

      <HistoryTrackDialog
        open={historyTrackOpen}
        onOpenChange={setHistoryTrackOpen}
        report={historyTrackReport}
        track={historyTrack}
        trackPath={historyTrackPath}
        mapCenter={historyMapCenter}
        mapMarkers={historyMapMarkers}
        TacticalMapComponent={TacticalMap}
        onDownloadGpx={downloadGpxFromReport}
      />

      <HistoryDetailDialog
        open={historyDetailOpen}
        onOpenChange={setHistoryDetailOpen}
        report={historyDetailReport}
        onOpenPhoto={handleOpenRoundPhoto}
        onDownloadPhoto={handleDownloadRoundPhoto}
        onDownloadAllPhotos={handleDownloadAllRoundPhotos}
      />

      <HistoryEditDialog
        open={historyEditOpen}
        onOpenChange={setHistoryEditOpen}
        roundName={historyEditRoundName}
        onRoundNameChange={setHistoryEditRoundName}
        postName={historyEditPostName}
        onPostNameChange={setHistoryEditPostName}
        officerName={historyEditOfficerName}
        onOfficerNameChange={setHistoryEditOfficerName}
        supervisorName={historyEditSupervisorName}
        onSupervisorNameChange={setHistoryEditSupervisorName}
        status={historyEditStatus}
        onStatusChange={setHistoryEditStatus}
        notes={historyEditNotes}
        onNotesChange={setHistoryEditNotes}
        saving={isSavingHistoryEdit}
        onSave={() => void handleSaveRoundEdit()}
      />

      <RoundEditDialog
        open={roundEditOpen}
        onOpenChange={setRoundEditOpen}
        name={roundEditName}
        onNameChange={setRoundEditName}
        post={roundEditPost}
        onPostChange={setRoundEditPost}
        status={roundEditStatus}
        onStatusChange={setRoundEditStatus}
        frequency={roundEditFrequency}
        onFrequencyChange={setRoundEditFrequency}
        instructions={roundEditInstructions}
        onInstructionsChange={setRoundEditInstructions}
        checkpoints={roundEditCheckpoints}
        onCheckpointsChange={setRoundEditCheckpoints}
        saving={isSavingRoundEdit}
        onSave={() => void handleSaveRoundDefinitionEdit()}
      />

      <AiSummaryDialog
        open={aiSummaryOpen}
        onOpenChange={setAiSummaryOpen}
        reportCode={aiSummaryReportCode}
        loading={!!aiSummaryLoadingId}
        text={aiSummaryText}
      />
    </div>
  )
}
