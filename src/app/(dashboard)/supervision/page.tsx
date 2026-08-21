"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  Plus, 
  Trash2, 
  Loader2,
  Camera,
  MapPin,
  ClipboardCheck,
  ListChecks,
  ShieldAlert,
  AlertCircle,
  Eye,
  Download,
  X,
  FileSpreadsheet,
  FileDown,
  Sparkles,
  Search,
  ChevronsUpDown,
  Check,
} from "lucide-react"
import { useSupervisionContext } from "@/hooks/use-supervision-context"
import { useSupabase, useUser } from "@/supabase"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import Image from "next/image"
import { buildEvidenceBundle, evaluateGeoRisk } from "@/lib/field-intel"
import { useSearchParams } from "next/navigation"
import { fetchInternalApi } from "@/lib/internal-api"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { downloadDataUrlAsFile, estimateDataUrlSizeKb, openDataUrlInNewTab, optimizeImageFileToDataUrl } from "@/lib/image-utils"
import {
  SUPERVISION_DRAFT_TTL_MS, GPS_HIGH_ACCURACY_GOAL_M, MAX_SUPERVISION_PHOTOS,
  NO_WEAPON_IN_POST_OPTION, SUPERVISION_EXPORT_DETAIL_BATCH_SIZE,
  getSupervisionDraftStorageKey, normalizeIdNumberInput, normalizePhoneInput,
  normalizeWeaponSerialInput, isNoWeaponInPostValue, toDateSafe,
  getSupervisionReportCode, getChecklistScore, getExecutiveResult,
  getSupervisionStatusLabel,
  getSupervisionQualityFlagSummary,
  formatSupervisionExportDateTime, formatSupervisionYesNo,
  getSupervisionChecklistReasonSummary, getSupervisionPropertySummary,
  getSupervisionGpsText, getSupervisionGeoRiskSummary,
  getSupervisionEvidenceSummary, getSupervisionExecutiveSummary,
  buildSupervisionPhotoFileName, parseSupervisionGps,
  buildSupervisionV2Checklist,
  matchesSupervisionOfficerSearch,
  type SupervisionChecklistEntry,
  type SupervisionChecklistStatus,
} from "./supervision-helpers"

const TacticalMap = dynamic(
  () => import("@/components/ui/tactical-map").then((m) => m.TacticalMap),
  { ssr: false }
)

const contradictoryNoveltyObservations = new Set([
  "sin novedad",
  "todo en orden",
  "todo bien",
  "sin observaciones",
  "ninguna",
  "n/a",
  "na",
])

function hasMeaningfulNoveltyObservation(value: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  return Boolean(normalized) && !contradictoryNoveltyObservations.has(normalized)
}

const SUPERVISION_CHECKLIST_ITEMS = [
  { id: "uniform", label: "Uniforme Táctico Completo" },
  { id: "equipment", label: "Equipo de Trabajo Reglamentario" },
  { id: "punctuality", label: "Puntualidad en Puesto" },
  { id: "service", label: "Actitud y Servicio" },
] as const

type SupervisionChecklistKey = (typeof SUPERVISION_CHECKLIST_ITEMS)[number]["id"]

function createInitialChecklistEntries(): Record<SupervisionChecklistKey, SupervisionChecklistEntry> {
  return Object.fromEntries(SUPERVISION_CHECKLIST_ITEMS.map((item) => [item.id, {
    status: "CONFORME",
    description: "",
    severity: "MEDIA",
    correctedOnsite: false,
    followUpRequired: false,
  }])) as Record<SupervisionChecklistKey, SupervisionChecklistEntry>
}

export default function SupervisionPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState("list")
  const [isLocating, setIsLocating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [photos, setPhotos] = useState<string[]>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [selectedReport, setSelectedReport] = useState<Record<string, unknown> | null>(null)
  const [selectedFindings, setSelectedFindings] = useState<Record<string, unknown>[]>([])
  const [canManageSelectedFindings, setCanManageSelectedFindings] = useState(false)
  const [closingFindingId, setClosingFindingId] = useState("")
  const [correctiveAction, setCorrectiveAction] = useState("")
  const [isClosingFinding, setIsClosingFinding] = useState(false)
  const [loadingDetailId, setLoadingDetailId] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const [editId, setEditId] = useState("")
  const [editOperationName, setEditOperationName] = useState("")
  const [editOfficerName, setEditOfficerName] = useState("")
  const [editReviewPost, setEditReviewPost] = useState("")
  const [editStatus, setEditStatus] = useState("CUMPLIM")
  const [editObservations, setEditObservations] = useState("")
  const [aiSummaryOpen, setAiSummaryOpen] = useState(false)
  const [aiSummaryLoadingId, setAiSummaryLoadingId] = useState("")
  const [aiSummaryReportCode, setAiSummaryReportCode] = useState("")
  const [aiSummaryText, setAiSummaryText] = useState("")
  const [preregisterOfficerOpen, setPreregisterOfficerOpen] = useState(false)
  const [isPreregisteringOfficer, setIsPreregisteringOfficer] = useState(false)
  const [preregisterOfficerName, setPreregisterOfficerName] = useState("")
  const [preregisterOfficerIdNumber, setPreregisterOfficerIdNumber] = useState("")
  const [preregisterOfficerPhone, setPreregisterOfficerPhone] = useState("")
  const [officerSearchOpen, setOfficerSearchOpen] = useState(false)
  const [officerSearch, setOfficerSearch] = useState("")
  const prefillAppliedRef = useRef(false)
  const contextErrorShownRef = useRef(false)
  const saveLockRef = useRef(false)
  const roleLevel = Number(user?.roleLevel ?? 1)
  const canEditSupervisionRecords = roleLevel >= 4
  const canEditSupervisionStatusNotes = roleLevel >= 2
  const canGenerateAiSummary = roleLevel >= 3
  const draftStorageKey = useMemo(() => getSupervisionDraftStorageKey(user), [user])

  const supervisionListSelect = useMemo(
    () =>
      [
        "id",
        "created_at",
        "operation_name",
        "officer_name",
        "type",
        "id_number",
        "officer_phone",
        "weapon_model",
        "weapon_serial",
        "review_post",
        "lugar",
        "gps",
        "photos",
        "evidence_bundle",
        "geo_risk",
        "checklist",
        "checklist_reasons",
        "property_details",
        "observations",
        "status",
        "supervisor_id",
      ].join(","),
    []
  )
  
  const [formData, setFormData] = useState({
    operationName: "",
    officerRegistryId: "",
    officerName: "",
    type: "Oficial de Seguridad" as "Oficial de Seguridad" | "Propiedad",
    idNumber: "",
    officerPhone: "",
    weaponModel: "",
    weaponSerial: "",
    reviewPost: "",
    lugar: "",
    gps: null as { lat: number, lng: number, accuracy?: number } | null,
    checklistEntries: createInitialChecklistEntries(),
    propertyDetails: {
      luz: "",
      perimetro: "",
      sacate: "",
      danosPropiedad: ""
    },
    observations: ""
  })

  const {
    reports: sourceReports,
    operationCatalog,
    weaponsCatalog,
    officerDirectory,
    reportsLoading,
    error: supervisionContextError,
    reload,
    addOptimisticReport,
  } = useSupervisionContext()

  useEffect(() => {
    if (!supervisionContextError) {
      contextErrorShownRef.current = false
      return
    }
    if (contextErrorShownRef.current) return
    // Suppress destructive toast when offline — the cached catalogs are still shown
    const msg = supervisionContextError.message?.toLowerCase() ?? ""
    if (msg.includes("fetch") || msg.includes("network") || msg.includes("offline")) {
      contextErrorShownRef.current = true
      return
    }
    toast({
      title: "Supervisión",
      description: supervisionContextError.message,
      variant: "destructive",
    })
    contextErrorShownRef.current = true
  }, [supervisionContextError, toast])

  const activeCatalog = useMemo(
    () =>
      (operationCatalog ?? []).filter((item) => item.isActive !== false).map((item) => ({
        id: String(item.id ?? "").trim(),
        operationName: String(item.operationName ?? "").trim(),
        clientName: String(item.clientName ?? "").trim(),
      })),
    [operationCatalog]
  )

  const operationOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((item) => item.operationName))).filter(Boolean),
    [activeCatalog]
  )

  const clientOptions = useMemo(
    () => Array.from(new Set(
      activeCatalog
        .filter((item) => item.operationName === String(formData.operationName ?? "").trim())
        .map((item) => item.clientName)
    )).filter(Boolean),
    [activeCatalog, formData.operationName]
  )

  const selectedOperationCatalogId = useMemo(
    () => activeCatalog.find((item) => (
      item.operationName === String(formData.operationName ?? "").trim()
      && item.clientName === String(formData.reviewPost ?? "").trim()
    ))?.id ?? "",
    [activeCatalog, formData.operationName, formData.reviewPost]
  )

  const selectableOfficers = useMemo(
    () => officerDirectory.filter((officer) => (
      officer.source !== "PREREGISTRO"
      || !selectedOperationCatalogId
      || (officer.operationCatalogIds ?? []).includes(selectedOperationCatalogId)
    )),
    [officerDirectory, selectedOperationCatalogId]
  )

  const selectedOfficer = useMemo(
    () => officerDirectory.find((officer) => officer.id === formData.officerRegistryId) ?? null,
    [formData.officerRegistryId, officerDirectory]
  )

  const filteredOfficerOptions = useMemo(() => {
    if (!officerSearch.trim()) return selectableOfficers.slice(0, 30)

    return selectableOfficers
      .filter((officer) => matchesSupervisionOfficerSearch(officer, officerSearch))
      .slice(0, 50)
  }, [officerSearch, selectableOfficers])

  const weaponModelOptions = useMemo(() => {
    const models = new Set(
      (weaponsCatalog ?? [])
        .map((w) => String(w.model ?? "").trim())
        .filter(Boolean)
    )

    const current = String(formData.weaponModel ?? "").trim()
    if (current) models.add(current)

    return Array.from(models).sort((a, b) => a.localeCompare(b))
  }, [weaponsCatalog, formData.weaponModel])

  const weaponSerialOptions = useMemo(() => {
    const selectedModel = String(formData.weaponModel ?? "").trim().toUpperCase()
    if (!selectedModel || isNoWeaponInPostValue(selectedModel)) return [] as string[]

    const serials = new Set(
      (weaponsCatalog ?? [])
        .filter((w) => String(w.model ?? "").trim().toUpperCase() === selectedModel)
        .map((w) => normalizeWeaponSerialInput(String(w.serial ?? "").trim()))
        .filter(Boolean)
    )

    const current = normalizeWeaponSerialInput(String(formData.weaponSerial ?? "").trim())
    if (current) serials.add(current)

    return Array.from(serials).sort((a, b) => a.localeCompare(b))
  }, [weaponsCatalog, formData.weaponModel, formData.weaponSerial])

  const noWeaponInPostSelected = useMemo(
    () => isNoWeaponInPostValue(formData.weaponModel),
    [formData.weaponModel]
  )

  const formatReportListDate = useCallback((value: unknown) => {
    const parsed = toDateSafe(value)
    return parsed ? parsed.toLocaleDateString() : "---"
  }, [])

  const visibleReports = useMemo(() => {
    const all = sourceReports
    const uid = String(user?.uid ?? "").trim().toLowerCase()
    const email = String(user?.email ?? "").trim().toLowerCase()
    const assignedTokens = String(user?.assigned ?? "")
      .split(/[|,;]+/)
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean)

    const belongsToCurrentUser = (r: Record<string, unknown>) => {
      const supervisorValue = String(r.supervisorId ?? "").trim().toLowerCase()
      const officerUserId = String(r.officerUserId ?? "").trim().toLowerCase()
      return (
        (!!supervisorValue && (supervisorValue === uid || supervisorValue === email)) ||
        (!!officerUserId && officerUserId === uid)
      )
    }

    const belongsToAssignedScope = (r: Record<string, unknown>) => {
      if (assignedTokens.length === 0) return false
      const operationValue = String(r.operationName ?? "").trim().toLowerCase()
      const postValue = String(r.reviewPost ?? "").trim().toLowerCase()
      return assignedTokens.some((token) => operationValue.includes(token) || postValue.includes(token))
    }

    if (roleLevel >= 3) {
      return all
    }

    if (roleLevel === 2) {
      return all.filter((r) => {
        const row = r as unknown as Record<string, unknown>
        return belongsToCurrentUser(row) || belongsToAssignedScope(row)
      })
    }

    if (roleLevel <= 1) {
      return all.filter((r) => belongsToCurrentUser(r as unknown as Record<string, unknown>))
    }

    return []
  }, [roleLevel, sourceReports, user])

  useEffect(() => {
    if (prefillAppliedRef.current) return
    const operation = (searchParams.get("operation") || "").trim()
    const post = (searchParams.get("post") || "").trim()
    if (!operation && !post) return

    setFormData((prev) => ({
      ...prev,
      operationName: operation || prev.operationName,
      reviewPost: post || prev.reviewPost,
    }))
    setActiveTab("new")
    prefillAppliedRef.current = true
  }, [searchParams])

  const officerHistoryByUserId = useMemo(() => {
    const byUserId = new Map<string, { idNumber: string; officerPhone: string }>()
    sourceReports.forEach((row) => {
      const officerIdentityId = String(row.officerRegistryId ?? row.officerUserId ?? "").trim()
      if (!officerIdentityId) return
      const current = byUserId.get(officerIdentityId) ?? { idNumber: "", officerPhone: "" }
      byUserId.set(officerIdentityId, {
        idNumber: current.idNumber || String(row.idNumber ?? "").trim(),
        officerPhone: current.officerPhone || String(row.officerPhone ?? "").trim(),
      })
    })
    return byUserId
  }, [sourceReports])

  const handleOfficerSelect = (officerRegistryId: string) => {
    const profile = officerDirectory.find((item) => item.id === officerRegistryId)
    const history = officerHistoryByUserId.get(officerRegistryId)
    setFormData((prev) => ({
      ...prev,
      officerRegistryId,
      officerName: profile?.name ?? "",
      idNumber: normalizeIdNumberInput(profile?.idNumber || history?.idNumber || ""),
      officerPhone: normalizePhoneInput(profile?.phone || history?.officerPhone || ""),
    }))
    setOfficerSearchOpen(false)
    setOfficerSearch("")
  }

  const handlePreregisterOfficer = async () => {
    if (!selectedOperationCatalogId) {
      toast({ title: "Seleccione el puesto", description: "Defina operación y puesto antes de prerregistrar al oficial.", variant: "destructive" })
      return
    }

    const name = preregisterOfficerName.trim()
    const idNumber = normalizeIdNumberInput(preregisterOfficerIdNumber)
    const phone = normalizePhoneInput(preregisterOfficerPhone)
    if (!name || !idNumber) {
      toast({ title: "Datos requeridos", description: "Nombre y cédula/ID son obligatorios.", variant: "destructive" })
      return
    }

    setIsPreregisteringOfficer(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/supervision/officers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, idNumber, phone, operationCatalogId: selectedOperationCatalogId }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        created?: boolean
        officer?: { id?: string; name?: string; idNumber?: string; phone?: string }
      }
      if (!response.ok || !result.officer?.id) {
        toast({ title: "No se pudo prerregistrar", description: result.error || "Revise los datos del oficial.", variant: "destructive" })
        return
      }

      setFormData((prev) => ({
        ...prev,
        officerRegistryId: String(result.officer?.id ?? ""),
        officerName: String(result.officer?.name ?? name),
        idNumber: normalizeIdNumberInput(String(result.officer?.idNumber ?? idNumber)),
        officerPhone: normalizePhoneInput(String(result.officer?.phone ?? phone)),
      }))
      await reload(false)
      setPreregisterOfficerOpen(false)
      setPreregisterOfficerName("")
      setPreregisterOfficerIdNumber("")
      setPreregisterOfficerPhone("")
      toast({
        title: result.created ? "Oficial prerregistrado" : "Oficial existente reutilizado",
        description: "Ya puede usarlo en esta y futuras supervisiones del puesto.",
      })
    } finally {
      setIsPreregisteringOfficer(false)
    }
  }

  useEffect(() => {
    if (typeof window === "undefined" || !draftStorageKey) return
    try {
      const raw = window.localStorage.getItem(draftStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        formData?: Partial<typeof formData> & {
          checklist?: Record<SupervisionChecklistKey, boolean>
          checklistReasons?: Record<SupervisionChecklistKey, string>
        }
        activeTab?: string
        storedAt?: string
      }
      const storedAt = new Date(String(parsed.storedAt ?? ""))
      if (Number.isNaN(storedAt.getTime()) || Date.now() - storedAt.getTime() > SUPERVISION_DRAFT_TTL_MS) {
        window.localStorage.removeItem(draftStorageKey)
        return
      }
      if (parsed.formData) {
        const { checklist, checklistReasons, ...draftFormData } = parsed.formData
        const checklistEntries = draftFormData.checklistEntries ?? Object.fromEntries(
          SUPERVISION_CHECKLIST_ITEMS.map((item) => [item.id, {
            ...createInitialChecklistEntries()[item.id],
            status: checklist?.[item.id] === false ? "NO_CONFORME" : "CONFORME",
            description: String(checklistReasons?.[item.id] ?? ""),
          }])
        ) as Record<SupervisionChecklistKey, SupervisionChecklistEntry>
        setFormData((prev) => ({ ...prev, ...draftFormData, checklistEntries }))
      }
      if (parsed.activeTab === "new" || parsed.activeTab === "list") {
        setActiveTab(parsed.activeTab)
      }
    } catch {
      window.localStorage.removeItem(draftStorageKey)
      // Si el borrador esta corrupto, se ignora silenciosamente.
    }
  }, [draftStorageKey])

  useEffect(() => {
    if (typeof window === "undefined" || !draftStorageKey) return
    const payload = {
      formData,
      activeTab: activeTab === "new" ? "new" : "list",
      storedAt: new Date().toISOString(),
    }
    try {
      window.localStorage.setItem(draftStorageKey, JSON.stringify(payload))
    } catch {
      window.localStorage.removeItem(draftStorageKey)
    }
  }, [activeTab, draftStorageKey, formData])

  const handleUseLastRecord = () => {
    const last = visibleReports[0]
    if (!last) {
      toast({ title: "Sin historial", description: "No hay un registro previo para reutilizar." })
      return
    }

    setFormData((prev) => ({
      ...prev,
      operationName: String(last.operationName ?? "").trim(),
      reviewPost: String(last.reviewPost ?? "").trim(),
      officerRegistryId: String(last.officerRegistryId ?? "").trim(),
      officerName: String(last.officerName ?? "").trim(),
      type: (String(last.type ?? "Oficial de Seguridad") === "Propiedad" ? "Propiedad" : "Oficial de Seguridad"),
      idNumber: normalizeIdNumberInput(String(last.idNumber ?? "").trim()),
      officerPhone: normalizePhoneInput(String(last.officerPhone ?? "").trim()),
      weaponModel: String(last.weaponModel ?? "").trim(),
      weaponSerial: normalizeWeaponSerialInput(String(last.weaponSerial ?? "").trim()),
      lugar: String(last.lugar ?? "").trim(),
    }))
    toast({ title: "Base cargada", description: "Se reutilizaron los datos principales del ultimo registro." })
  }

  const requestCurrentPosition = useCallback((options: PositionOptions) => new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options)
  }), [])

  const getGpsErrorMessage = useCallback((error: unknown) => {
    const code = Number((error as { code?: unknown } | null)?.code ?? 0)
    if (code === 1) return "Permiso de ubicación denegado. Active GPS/permisos del navegador."
    if (code === 2) return "No se pudo determinar la ubicación actual. Revise señal GPS."
    if (code === 3) return "Tiempo agotado obteniendo GPS. Intente nuevamente en un área abierta."
    return "No se pudo acceder a la ubicación."
  }, [])

  const handleGetGPS = async () => {
    if (isLocating) return
    setIsLocating(true)
    if (!("geolocation" in navigator)) {
      setIsLocating(false)
      toast({ title: "GPS no disponible", description: "Este dispositivo no soporta geolocalización.", variant: "destructive" })
      return
    }

    const applyGpsPoint = (position: GeolocationPosition) => {
      const accuracy = Number(position.coords.accuracy ?? 0)
      setFormData((prev) => ({
        ...prev,
        gps: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy },
      }))

      if (accuracy > GPS_HIGH_ACCURACY_GOAL_M) {
        toast({
          title: "GPS capturado con baja precision",
          description: `Precision actual: ${Math.round(accuracy)} m. Use "Actualizar GPS" para mejorar el punto.`,
          variant: "destructive",
        })
        return
      }

      toast({ title: "GPS FIJADO", description: `Coordenadas capturadas. Precision: ${Math.round(accuracy)} m.` })
    }

    try {
      const highAccuracyPosition = await requestCurrentPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      })
      applyGpsPoint(highAccuracyPosition)
    } catch (highAccuracyError) {
      try {
        const fallbackPosition = await requestCurrentPosition({
          enableHighAccuracy: false,
          maximumAge: 60000,
          timeout: 10000,
        })
        applyGpsPoint(fallbackPosition)
        toast({
          title: "GPS capturado con modo alterno",
          description: "Se obtuvo ubicación con precisión estándar por señal/permisos del dispositivo.",
        })
      } catch (fallbackError) {
        toast({ title: "ERROR GPS", description: getGpsErrorMessage(fallbackError ?? highAccuracyError), variant: "destructive" })
      }
    } finally {
      setIsLocating(false)
    }
  }

  const handlePhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    if (!files.length) return

    setActiveTab("new")

    if (photos.length >= MAX_SUPERVISION_PHOTOS) {
      toast({
        title: "Limite de fotos",
        description: `Solo se permiten ${MAX_SUPERVISION_PHOTOS} fotos por revision.`,
        variant: "destructive",
      })
      e.target.value = ""
      return
    }

    const availableSlots = Math.max(MAX_SUPERVISION_PHOTOS - photos.length, 0)
    const selected = files.filter((file) => file.type.startsWith("image/")).slice(0, availableSlots)

    if (!selected.length) {
      toast({
        title: "Sin imagenes validas",
        description: "Seleccione archivos de imagen para continuar.",
        variant: "destructive",
      })
      e.target.value = ""
      return
    }

    try {
      const optimized = await Promise.all(
        selected.map((file) => optimizeImageFileToDataUrl(file, {
          maxWidth: 1600,
          maxHeight: 1600,
          quality: 0.72,
          watermark: {
            label: "HO Seguridad | Supervision",
            capturedAt: nowIso(),
            gps: formData.gps,
            extraLines: [formData.reviewPost || formData.operationName].filter(Boolean),
          },
        }))
      )

      setPhotos((prev) => [...prev, ...optimized])

      const totalKb = optimized.reduce((acc, item) => acc + estimateDataUrlSizeKb(item), 0)
      toast({
        title: selected.length > 1 ? "Fotos agregadas" : "Foto agregada",
        description: `${selected.length} archivo(s) optimizado(s) (${totalKb} KB aprox).`,
      })
    } catch {
      toast({
        title: "Foto no disponible",
        description: "No se pudieron procesar las imagenes seleccionadas.",
        variant: "destructive",
      })
    }

    if (files.length > selected.length) {
      toast({
        title: "Limite aplicado",
        description: `Se agregaron ${selected.length} de ${files.length} archivos por limite de ${MAX_SUPERVISION_PHOTOS} fotos.`,
      })
    }

    e.target.value = ""
  }
  const handlePreparePhotoPicker = () => {
    setActiveTab("new")
  }

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index))
  }

  const fetchDetailedReportsByIds = useCallback(async (ids: string[]) => {
    const mapDbRowToView = (row: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      const timestampKeys = ["created_at", "updated_at", "entry_time", "exit_time", "last_check", "time", "timestamp", "synced_at"]
      for (const [k, v] of Object.entries(row)) {
        const camel = k.replace(/_([a-z])/g, (_, l) => l.toUpperCase())
        if (timestampKeys.includes(k) && v) {
          out[camel] = { toDate: () => new Date(v as string) }
        } else {
          out[camel] = v
        }
      }
      out.id = row.id
      return out
    }

    const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)))
    if (!uniqueIds.length) return [] as Record<string, unknown>[]

    const rows: Record<string, unknown>[] = []

    for (let index = 0; index < uniqueIds.length; index += SUPERVISION_EXPORT_DETAIL_BATCH_SIZE) {
      const batchIds = uniqueIds.slice(index, index + SUPERVISION_EXPORT_DETAIL_BATCH_SIZE)
      const response = await fetchInternalApi(
        supabase,
        `/api/supervision/context?ids=${encodeURIComponent(batchIds.join(","))}`,
        { cache: "no-store" },
        { refreshIfMissingToken: false, retryOnUnauthorized: false }
      )
      const body = await response.json().catch(() => null) as { records?: Record<string, unknown>[]; error?: string } | null

      if (!response.ok || !Array.isArray(body?.records)) {
        throw new Error(body?.error ?? "No se pudo cargar el detalle de supervisiones.")
      }

      rows.push(...body.records.map(mapDbRowToView))
    }

    return rows
  }, [supabase])

  const handleOpenReport = async (report: Record<string, unknown>) => {
    const id = String(report.id ?? "")
    if (!id) return

    setLoadingDetailId(id)
    try {
      const [detailedReport, findingsResponse] = await Promise.all([
        fetchDetailedReportsByIds([id]).then((records) => records[0] ?? null),
        fetchInternalApi(supabase, `/api/supervisions?id=${encodeURIComponent(id)}`, { cache: "no-store" }),
      ])
      const findingsBody = await findingsResponse.json().catch(() => null) as {
        findings?: Record<string, unknown>[]
        canManage?: boolean
      } | null
      setSelectedFindings(findingsResponse.ok && Array.isArray(findingsBody?.findings) ? findingsBody.findings : [])
      setCanManageSelectedFindings(findingsResponse.ok && findingsBody?.canManage === true)
      if (!detailedReport) {
        setSelectedReport(report)
        return
      }

      setSelectedReport(detailedReport)
    } finally {
      setLoadingDetailId(null)
    }
  }

  const handleCloseFinding = async () => {
    if (!closingFindingId || !correctiveAction.trim() || isClosingFinding) return
    setIsClosingFinding(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/supervisions", {
        method: "PATCH",
        body: JSON.stringify({
          finding_id: closingFindingId,
          status: "CERRADO",
          corrective_action: correctiveAction.trim(),
        }),
      })
      const body = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) {
        toast({ title: "No se pudo cerrar", description: body?.error ?? "Revise la acción correctiva.", variant: "destructive" })
        return
      }

      setSelectedFindings((current) => current.map((finding) => (
        String(finding.id ?? "") === closingFindingId
          ? { ...finding, status: "CERRADO", corrective_action: correctiveAction.trim(), verified_at: nowIso() }
          : finding
      )))
      setClosingFindingId("")
      setCorrectiveAction("")
      toast({ title: "Hallazgo cerrado", description: "La acción correctiva quedó registrada." })
    } finally {
      setIsClosingFinding(false)
    }
  }

  const handleOpenEdit = (report: Record<string, unknown>) => {
    if (!canEditSupervisionStatusNotes) return
    setEditId(String(report.id ?? ""))
    setEditOperationName(String(report.operationName ?? ""))
    setEditOfficerName(String(report.officerName ?? ""))
    setEditReviewPost(String(report.reviewPost ?? ""))
    setEditStatus(String(report.status ?? "CUMPLIM"))
    setEditObservations(String(report.observations ?? ""))
    setEditOpen(true)
  }

  const handleGenerateAiSummary = async (report: Record<string, unknown>) => {
    if (!canGenerateAiSummary) {
      toast({ title: "IA restringida", description: "La generación IA está disponible solo para L3/L4.", variant: "destructive" })
      return
    }
    const reportId = String(report.id ?? "").trim()
    if (!reportId) return

    const createdAt = (report.createdAt as { toDate?: () => Date } | undefined)?.toDate?.() ?? null
    const payload = {
      reportCode: getSupervisionReportCode(report),
      date: createdAt?.toLocaleDateString?.() ?? "-",
      hour: createdAt?.toLocaleTimeString?.([], { hour: "2-digit", minute: "2-digit" }) ?? "-",
      operationName: String(report.operationName ?? "-"),
      officerName: String(report.officerName ?? "-"),
      reviewPost: String(report.reviewPost ?? "-"),
      type: String(report.type ?? "-"),
      idNumber: String(report.idNumber ?? "-"),
      weaponModel: String(report.weaponModel ?? "-"),
      weaponSerial: String(report.weaponSerial ?? "-"),
      lugar: String(report.lugar ?? "-"),
      status: String(report.status ?? "-"),
      checklist: report.checklist ?? {},
      checklistReasons: report.checklistReasons ?? {},
      propertyDetails: report.propertyDetails ?? {},
      observations: String(report.observations ?? ""),
    }

    setAiSummaryLoadingId(reportId)
    setAiSummaryText("")
    setAiSummaryReportCode(payload.reportCode)
    setAiSummaryOpen(true)

    try {
      const response = await fetchInternalApi(supabase, "/api/ai/supervision-summary", {
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
  }

  const handleSaveEdit = async () => {
    if (!canEditSupervisionStatusNotes || !editId) return
    if (editStatus === "CON NOVEDAD" && !hasMeaningfulNoveltyObservation(editObservations)) {
      toast({
        title: "Descripción requerida",
        description: "Describa el hallazgo detectado para registrar una novedad.",
        variant: "destructive",
      })
      return
    }

    setIsSavingEdit(true)
    const payload = toSnakeCaseKeys(
      canEditSupervisionRecords
        ? {
          operationName: editOperationName.trim() || null,
          officerName: editOfficerName.trim() || null,
          reviewPost: editReviewPost.trim() || null,
          status: editStatus,
          observations: editObservations.trim() || null,
        }
        : {
          status: editStatus,
          observations: editObservations.trim() || null,
        }
    ) as Record<string, unknown>

    try {
      const response = await fetchInternalApi(supabase, "/api/supervisions", {
        method: "PATCH",
        body: JSON.stringify({ id: editId, ...payload }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo actualizar la boleta."), variant: "destructive" })
        return
      }

      toast({
        title: "Boleta actualizada",
        description: "Cambios guardados correctamente.",
      })
      void reload(false)
      setEditOpen(false)
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar la boleta.", variant: "destructive" })
    } finally {
      setIsSavingEdit(false)
    }
  }

  const createSubmissionId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  const handleAddReport = async () => {
    if (!user || isSaving || saveLockRef.current) return

    saveLockRef.current = true
    setIsSaving(true)

    try {
      const submissionId = createSubmissionId()

      const normalizedIdNumber = normalizeIdNumberInput(formData.idNumber)
      const normalizedPhone = normalizePhoneInput(formData.officerPhone)
      const normalizedWeaponSerial = normalizeWeaponSerialInput(formData.weaponSerial)

      const missingFields: string[] = []
      if (!String(formData.operationName).trim()) missingFields.push("Operacion")
      if (!String(formData.reviewPost).trim()) missingFields.push("Cliente")
      // En revisión de propiedad el oficial es opcional (puede ser propiedad sin oficial, solo rondas).
      if (formData.type !== "Propiedad") {
        if (!String(formData.officerRegistryId).trim()) missingFields.push("Oficial registrado o prerregistrado")
        if (!normalizedIdNumber.trim()) missingFields.push("Cedula / ID")
      }
      if (!formData.gps) missingFields.push("GPS")

      if (missingFields.length > 0) {
        toast({
          title: "Campos requeridos",
          description: `Complete: ${missingFields.join(", ")}`,
          variant: "destructive",
        })
        return
      }

      if (formData.type === "Oficial de Seguridad") {
        const issues = Object.values(formData.checklistEntries).filter((entry) => (
          entry.status === "NO_CONFORME" && !entry.description.trim()
        ))
        if (issues.length > 0) {
          toast({ title: "CAMPOS REQUERIDOS", description: "Describa cada estándar no conforme.", variant: "destructive" })
          return
        }
      }

      const checklistV2 = formData.type === "Oficial de Seguridad"
        ? buildSupervisionV2Checklist(formData.checklistEntries)
        : null
      const statusValue = formData.type === "Propiedad"
        ? "REVISIÓN PROPIEDAD"
        : (checklistV2?.findingRequired ? "CON NOVEDAD" : "CUMPLIM")

      if (statusValue === "CON NOVEDAD" && photos.length === 0) {
        toast({
          title: "Evidencia requerida",
          description: "Cuando existe novedad, debe adjuntar al menos una foto.",
          variant: "destructive",
        })
        return
      }

      const gpsPoint = formData.gps ? { ...formData.gps, capturedAt: nowIso() } : null
      const geoRisk = evaluateGeoRisk(gpsPoint)
      const findingObservation = checklistV2?.findings.map((finding) => finding.description).filter(Boolean).join(" | ") ?? ""
      const observations = formData.observations.trim() || findingObservation

      const row = toSnakeCaseKeys({
        id: submissionId,
        operationName: formData.operationName,
        officerRegistryId: formData.officerRegistryId,
        officerName: formData.officerName,
        type: formData.type,
        idNumber: normalizedIdNumber,
        officerPhone: normalizedPhone || undefined,
        weaponModel: formData.weaponModel,
        weaponSerial: normalizedWeaponSerial,
        reviewPost: formData.reviewPost,
        lugar: formData.lugar || undefined,
        propertyDetails: formData.type === "Propiedad" ? formData.propertyDetails : undefined,
        photos,
        // Id fijo por envío para evitar duplicados por doble click/reintento de red.
        supervisorId: user.uid,
        createdAt: nowIso(),
        status: statusValue,
        checklist: checklistV2?.checklist,
        checklistReasons: checklistV2?.checklistReasons,
        checklistVersion: checklistV2 ? 2 : undefined,
        findingRequired: checklistV2?.findingRequired,
        correctedOnsite: checklistV2?.correctedOnsite,
        followUpRequired: checklistV2?.followUpRequired,
        observations,
        gps: formData.gps,
        evidenceBundle: buildEvidenceBundle({
          checkpointId: formData.reviewPost || "supervision",
          gps: gpsPoint,
          photos,
          user,
        }),
        geoRisk,
      }) as Record<string, unknown>
      if (checklistV2?.findings.length) {
        row.findings = checklistV2.findings.map((finding) => toSnakeCaseKeys({
          ...finding,
          category: SUPERVISION_CHECKLIST_ITEMS.find((item) => item.id === finding.checklistKey)?.label ?? finding.category,
        }))
      }

      const resetFormAfterSave = () => {
        setActiveTab("list")
        setPhotos([])
        setFormData({
          operationName: "",
          officerRegistryId: "",
          officerName: "",
          type: "Oficial de Seguridad",
          idNumber: "",
          officerPhone: "",
          weaponModel: "",
          weaponSerial: "",
          reviewPost: "",
          lugar: "",
          gps: null,
          checklistEntries: createInitialChecklistEntries(),
          propertyDetails: { luz: "", perimetro: "", sacate: "", danosPropiedad: "" },
          observations: "",
        })
        if (typeof window !== "undefined" && draftStorageKey) {
          window.localStorage.removeItem(draftStorageKey)
        }
      }

      const queueReportForOffline = async (queueError?: string) => {
        const offlineResult = await runMutationWithOffline(supabase, {
          table: "supervisions",
          action: "insert",
          payload: row,
          endpoint: "/api/supervisions",
          forceQueue: true,
          queueError,
        })

        if (offlineResult.queued) {
          toast({
            title: "SIN CONEXIÓN — Guardado localmente",
            description: "La supervisión se enviará automáticamente al recuperar señal.",
          })
          void reload(false)
          resetFormAfterSave()
          return true
        }

        toast({
          title: "Sin conexión",
          description: offlineResult.error || "No se pudo guardar la supervisión. Recupere señal e intente de nuevo.",
          variant: "destructive",
        })
        return false
      }

      let response: Response
      try {
        response = await fetchInternalApi(supabase, "/api/supervisions", {
          method: "POST",
          body: JSON.stringify(row),
        })
      } catch {
        // If internal API is unreachable, force queue even when navigator reports online.
        await queueReportForOffline("fetch failed")
        return
      }
      const result = (await response.json().catch(() => null)) as { error?: string; warning?: string | null } | null
      if (!response.ok) {
        const rawMessage = String(result?.error || "")
        const normalized = rawMessage.toLowerCase()
        const transientServerFailure =
          response.status >= 500 ||
          normalized.includes("service unavailable") ||
          normalized.includes("gateway timeout") ||
          normalized.includes("temporarily unavailable") ||
          normalized.includes("failed to fetch")
        const duplicateBlocked =
          normalized.includes("duplicate supervision submission detected") ||
          normalized.includes("duplicate key value")
        const payloadTooLarge =
          normalized.includes("payload too large") ||
          normalized.includes("request entity too large") ||
          normalized.includes("413") ||
          normalized.includes("too large")
        const schemaMismatch =
          normalized.includes("officer_phone") ||
          normalized.includes("evidence_bundle") ||
          normalized.includes("geo_risk")

        if (duplicateBlocked) {
          toast({
            title: "Duplicado bloqueado",
            description: "Ya existia un envio igual reciente. Evitamos guardar la supervision dos veces.",
          })
          return
        }

        if (transientServerFailure) {
          await queueReportForOffline(rawMessage || `http-${response.status}`)
          return
        }

        if (!schemaMismatch && !payloadTooLarge) {
          toast({ title: "Error", description: rawMessage || "No se pudo guardar la supervision.", variant: "destructive" })
          return
        }

        if (payloadTooLarge) {
          toast({
            title: "Fotos demasiado pesadas",
            description: "Reduzca cantidad o calidad de fotos y reintente.",
            variant: "destructive",
          })
          return
        }

        toast({ title: "Error", description: rawMessage || "No se pudo guardar la supervision.", variant: "destructive" })
        return
      }

      addOptimisticReport(row)

      if (result?.warning) {
        toast({
          title: "Registro guardado con compatibilidad",
          description: String(result.warning),
          variant: "destructive",
        })
      } else {
        toast({
          title: "REGISTRO GUARDADO",
          description: "Fiscalización almacenada exitosamente.",
        })
      }
      void reload(false)
      resetFormAfterSave()
    } finally {
      saveLockRef.current = false
      setIsSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/supervisions", {
        method: "DELETE",
        body: JSON.stringify({ id }),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) throw new Error(String(result?.error ?? "No se pudo eliminar el registro."))
      void reload(false)
      toast({
        title: "Eliminado",
        description: "El registro de supervisión se eliminó correctamente.",
      })
    } catch (error) {
      const detail = error instanceof Error ? String(error.message ?? "").trim() : ""
      toast({ title: "Error", description: detail || "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const detailedReports = await fetchDetailedReportsByIds(visibleReports.map((report) => String(report.id ?? "")))
    const detailedById = new Map(detailedReports.map((report) => [String(report.id ?? ""), report]))

    const rows = visibleReports.map((summaryReport) => {
      const r = (detailedById.get(String(summaryReport.id ?? "")) ?? summaryReport) as Record<string, unknown>
      return ({
      codigoBoleta: getSupervisionReportCode(r as unknown as Record<string, unknown>),
      fechaHora: formatSupervisionExportDateTime(r.createdAt),
      operacion: r.operationName || "—",
      tipo: r.type || "—",
      oficial: r.officerName || "—",
      supervisor: String(r.supervisorId ?? "—"),
      cedula: r.idNumber || "—",
      telefono: r.officerPhone || "—",
      puesto: r.reviewPost || "—",
      lugar: r.lugar || "—",
      arma: r.weaponModel || "—",
      serieArma: r.weaponSerial || "—",
      estado: getSupervisionStatusLabel(r.status),
      resultado: getExecutiveResult(r as unknown as Record<string, unknown>),
      cumplimientoPct: `${getChecklistScore(r as unknown as Record<string, unknown>).pct}%`,
      riesgoGps: getSupervisionGeoRiskSummary(r as unknown as Record<string, unknown>).riskLevel.toUpperCase(),
      banderasGps: getSupervisionGeoRiskSummary(r as unknown as Record<string, unknown>).flagsText,
      velocidadGps: getSupervisionGeoRiskSummary(r as unknown as Record<string, unknown>).speedText,
      uniforme: formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.uniform),
      equipo: formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.equipment),
      puntualidad: formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.punctuality),
      servicio: formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.service),
      justificaciones: getSupervisionChecklistReasonSummary(r as unknown as Record<string, unknown>),
      luz: (r.propertyDetails as Record<string, unknown> | undefined)?.luz || "—",
      perimetro: (r.propertyDetails as Record<string, unknown> | undefined)?.perimetro || "—",
      sacate: (r.propertyDetails as Record<string, unknown> | undefined)?.sacate || "—",
      danosPropiedad: (r.propertyDetails as Record<string, unknown> | undefined)?.danosPropiedad || "—",
      gps: getSupervisionGpsText(r as unknown as Record<string, unknown>),
      evidencias: getSupervisionEvidenceSummary(r as unknown as Record<string, unknown>).photoCount,
      evidenciaDigital: getSupervisionEvidenceSummary(r as unknown as Record<string, unknown>).summary,
      resumenPropiedad: getSupervisionPropertySummary(r as unknown as Record<string, unknown>),
      resumenEjecutivo: getSupervisionExecutiveSummary(r as unknown as Record<string, unknown>),
      alertasCalidad: getSupervisionQualityFlagSummary(r as unknown as Record<string, unknown>),
      observaciones: r.observations || "—",
      })
    })
    const result = await exportToExcel(rows, "Supervisión", [
      { header: "CODIGO BOLETA", key: "codigoBoleta", width: 20 },
      { header: "FECHA/HORA", key: "fechaHora", width: 22 },
      { header: "OPERACIÓN", key: "operacion", width: 22 },
      { header: "TIPO", key: "tipo", width: 18 },
      { header: "OFICIAL", key: "oficial", width: 22 },
      { header: "SUPERVISOR", key: "supervisor", width: 24 },
      { header: "CEDULA", key: "cedula", width: 14 },
      { header: "TELEFONO", key: "telefono", width: 14 },
      { header: "PUESTO", key: "puesto", width: 20 },
      { header: "LUGAR", key: "lugar", width: 24 },
      { header: "ARMA", key: "arma", width: 15 },
      { header: "SERIE ARMA", key: "serieArma", width: 15 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "RESULTADO", key: "resultado", width: 16 },
      { header: "CUMPLIMIENTO", key: "cumplimientoPct", width: 14 },
      { header: "RIESGO GPS", key: "riesgoGps", width: 14 },
      { header: "BANDERAS GPS", key: "banderasGps", width: 28 },
      { header: "VEL. GPS", key: "velocidadGps", width: 12 },
      { header: "UNIFORME", key: "uniforme", width: 10 },
      { header: "EQUIPO", key: "equipo", width: 10 },
      { header: "PUNTUALIDAD", key: "puntualidad", width: 12 },
      { header: "SERVICIO", key: "servicio", width: 10 },
      { header: "JUSTIFICACIONES", key: "justificaciones", width: 45 },
      { header: "LUZ", key: "luz", width: 14 },
      { header: "PERÍMETRO", key: "perimetro", width: 14 },
      { header: "SACATE", key: "sacate", width: 14 },
      { header: "DAÑOS PROPIEDAD", key: "danosPropiedad", width: 32 },
      { header: "GPS", key: "gps", width: 24 },
      { header: "EVIDENCIAS", key: "evidencias", width: 10 },
      { header: "EVIDENCIA DIGITAL", key: "evidenciaDigital", width: 42 },
      { header: "RESUMEN PROPIEDAD", key: "resumenPropiedad", width: 42 },
      { header: "RESUMEN EJECUTIVO", key: "resumenEjecutivo", width: 42 },
      { header: "ALERTAS CALIDAD", key: "alertasCalidad", width: 42 },
      { header: "OBSERVACIONES", key: "observaciones", width: 45 },
    ], "HO_SUPERVISION")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const detailedReports = await fetchDetailedReportsByIds(visibleReports.map((report) => String(report.id ?? "")))
    const detailedById = new Map(detailedReports.map((report) => [String(report.id ?? ""), report]))
    const rows = visibleReports.map((summaryReport) => {
      const r = (detailedById.get(String(summaryReport.id ?? "")) ?? summaryReport) as Record<string, unknown>
      const score = getChecklistScore(r as unknown as Record<string, unknown>)
      const geo = getSupervisionGeoRiskSummary(r as unknown as Record<string, unknown>)
      const evidence = getSupervisionEvidenceSummary(r as unknown as Record<string, unknown>)
      return [
        getSupervisionReportCode(r as unknown as Record<string, unknown>),
        formatSupervisionExportDateTime(r.createdAt),
        `${String(r.operationName || "—")}\n${String(r.reviewPost || "—")}\n${String(r.type || "—")}`,
        `${String(r.officerName || "—")}\nID:${String(r.idNumber || "—")}\nTEL:${String(r.officerPhone || "—")}`,
        `${getExecutiveResult(r as unknown as Record<string, unknown>)}\nEstado: ${getSupervisionStatusLabel(r.status)}\nCumplimiento: ${score.pct}% (${score.passed}/${score.total})`,
        `GPS: ${getSupervisionGpsText(r as unknown as Record<string, unknown>)}\nRiesgo: ${geo.label}\nVelocidad: ${geo.speedText}`,
        `U:${formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.uniform)} E:${formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.equipment)} P:${formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.punctuality)} S:${formatSupervisionYesNo((r.checklist as Record<string, unknown> | undefined)?.service)}\nJustif: ${getSupervisionChecklistReasonSummary(r as unknown as Record<string, unknown>)}`,
        `${evidence.summary}\nPropiedad: ${getSupervisionPropertySummary(r as unknown as Record<string, unknown>)}`,
        `${getSupervisionExecutiveSummary(r as unknown as Record<string, unknown>)}\nCalidad: ${getSupervisionQualityFlagSummary(r as unknown as Record<string, unknown>)}\nObs: ${String(r.observations || "—")}`,
      ]
    })
    const result = await exportToPdf(
      "BOLETA DE SUPERVISIÓN - RESUMEN EJECUTIVO",
      ["CODIGO", "FECHA/HORA", "OPERACIÓN/PUESTO", "OFICIAL", "RESULTADO", "GPS/RIESGO", "CHECKLIST", "EVIDENCIA/PROPIEDAD", "CIERRE EJECUTIVO"],
      rows,
      "HO_BOLETA_SUPERVISION_EJECUTIVA"
    )
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportSingleExcel = async (report: Record<string, unknown>) => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const detailedReport = String(report.id ?? "").trim()
      ? (await fetchDetailedReportsByIds([String(report.id ?? "")]))[0] ?? report
      : report
    const row = {
      codigoBoleta: getSupervisionReportCode(detailedReport),
      fechaHora: formatSupervisionExportDateTime(detailedReport.createdAt),
      operacion: String(detailedReport.operationName ?? "—"),
      tipo: String(detailedReport.type ?? "—"),
      oficial: String(detailedReport.officerName ?? "—"),
      supervisor: String(detailedReport.supervisorId ?? "—"),
      cedula: String(detailedReport.idNumber ?? "—"),
      telefono: String(detailedReport.officerPhone ?? "—"),
      puesto: String(detailedReport.reviewPost ?? "—"),
      lugar: String(detailedReport.lugar ?? "—"),
      arma: String(detailedReport.weaponModel ?? "—"),
      serieArma: String(detailedReport.weaponSerial ?? "—"),
      estado: getSupervisionStatusLabel(detailedReport.status),
      resultado: getExecutiveResult(detailedReport),
      cumplimientoPct: `${getChecklistScore(detailedReport).pct}%`,
      riesgoGps: getSupervisionGeoRiskSummary(detailedReport).riskLevel.toUpperCase(),
      banderasGps: getSupervisionGeoRiskSummary(detailedReport).flagsText,
      velocidadGps: getSupervisionGeoRiskSummary(detailedReport).speedText,
      uniforme: formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.uniform),
      equipo: formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.equipment),
      puntualidad: formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.punctuality),
      servicio: formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.service),
      justificaciones: getSupervisionChecklistReasonSummary(detailedReport),
      luz: String((detailedReport.propertyDetails as Record<string, unknown> | undefined)?.luz ?? "—"),
      perimetro: String((detailedReport.propertyDetails as Record<string, unknown> | undefined)?.perimetro ?? "—"),
      sacate: String((detailedReport.propertyDetails as Record<string, unknown> | undefined)?.sacate ?? "—"),
      danosPropiedad: String((detailedReport.propertyDetails as Record<string, unknown> | undefined)?.danosPropiedad ?? "—"),
      gps: getSupervisionGpsText(detailedReport),
      evidencias: getSupervisionEvidenceSummary(detailedReport).photoCount,
      evidenciaDigital: getSupervisionEvidenceSummary(detailedReport).summary,
      resumenPropiedad: getSupervisionPropertySummary(detailedReport),
      resumenEjecutivo: getSupervisionExecutiveSummary(detailedReport),
      alertasCalidad: getSupervisionQualityFlagSummary(detailedReport),
      observaciones: String(detailedReport.observations ?? "—"),
    }

    const result = await exportToExcel([row], "Supervisión", [
      { header: "CODIGO BOLETA", key: "codigoBoleta", width: 20 },
      { header: "FECHA/HORA", key: "fechaHora", width: 22 },
      { header: "OPERACIÓN", key: "operacion", width: 22 },
      { header: "TIPO", key: "tipo", width: 18 },
      { header: "OFICIAL", key: "oficial", width: 22 },
      { header: "SUPERVISOR", key: "supervisor", width: 24 },
      { header: "CEDULA", key: "cedula", width: 14 },
      { header: "TELEFONO", key: "telefono", width: 14 },
      { header: "PUESTO", key: "puesto", width: 20 },
      { header: "LUGAR", key: "lugar", width: 24 },
      { header: "ARMA", key: "arma", width: 15 },
      { header: "SERIE ARMA", key: "serieArma", width: 15 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "RESULTADO", key: "resultado", width: 16 },
      { header: "CUMPLIMIENTO", key: "cumplimientoPct", width: 14 },
      { header: "RIESGO GPS", key: "riesgoGps", width: 14 },
      { header: "BANDERAS GPS", key: "banderasGps", width: 28 },
      { header: "VEL. GPS", key: "velocidadGps", width: 12 },
      { header: "UNIFORME", key: "uniforme", width: 10 },
      { header: "EQUIPO", key: "equipo", width: 10 },
      { header: "PUNTUALIDAD", key: "puntualidad", width: 12 },
      { header: "SERVICIO", key: "servicio", width: 10 },
      { header: "JUSTIFICACIONES", key: "justificaciones", width: 45 },
      { header: "LUZ", key: "luz", width: 14 },
      { header: "PERÍMETRO", key: "perimetro", width: 14 },
      { header: "SACATE", key: "sacate", width: 14 },
      { header: "DAÑOS PROPIEDAD", key: "danosPropiedad", width: 32 },
      { header: "GPS", key: "gps", width: 24 },
      { header: "EVIDENCIAS", key: "evidencias", width: 10 },
      { header: "EVIDENCIA DIGITAL", key: "evidenciaDigital", width: 42 },
      { header: "RESUMEN PROPIEDAD", key: "resumenPropiedad", width: 42 },
      { header: "RESUMEN EJECUTIVO", key: "resumenEjecutivo", width: 42 },
      { header: "ALERTAS CALIDAD", key: "alertasCalidad", width: 42 },
      { header: "OBSERVACIONES", key: "observaciones", width: 45 },
    ], `HO_SUPERVISION_${getSupervisionReportCode(detailedReport)}`)

    if (result.ok) toast({ title: "Excel individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportSinglePdf = async (report: Record<string, unknown>) => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const detailedReport = String(report.id ?? "").trim()
      ? (await fetchDetailedReportsByIds([String(report.id ?? "")]))[0] ?? report
      : report
    const score = getChecklistScore(detailedReport)
    const geo = getSupervisionGeoRiskSummary(detailedReport)
    const evidence = getSupervisionEvidenceSummary(detailedReport)
    const rows: (string | number)[][] = [[
      getSupervisionReportCode(detailedReport),
      formatSupervisionExportDateTime(detailedReport.createdAt),
      `${String(detailedReport.operationName ?? "—")}\n${String(detailedReport.reviewPost ?? "—")}\n${String(detailedReport.type ?? "—")}`,
      `${String(detailedReport.officerName ?? "—")}\nID:${String(detailedReport.idNumber ?? "—")}\nTEL:${String(detailedReport.officerPhone ?? "—")}`,
      `${getExecutiveResult(detailedReport)}\nEstado: ${getSupervisionStatusLabel(detailedReport.status)}\nCumplimiento: ${score.pct}% (${score.passed}/${score.total})`,
      `GPS: ${getSupervisionGpsText(detailedReport)}\nRiesgo: ${geo.label}\nVelocidad: ${geo.speedText}`,
      `U:${formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.uniform)} E:${formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.equipment)} P:${formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.punctuality)} S:${formatSupervisionYesNo((detailedReport.checklist as Record<string, unknown> | undefined)?.service)}\nJustif: ${getSupervisionChecklistReasonSummary(detailedReport)}`,
      `${evidence.summary}\nPropiedad: ${getSupervisionPropertySummary(detailedReport)}`,
      `${getSupervisionExecutiveSummary(detailedReport)}\nCalidad: ${getSupervisionQualityFlagSummary(detailedReport)}\nObs: ${String(detailedReport.observations ?? "—")}`,
    ]]

    const result = await exportToPdf(
      "BOLETA DE SUPERVISIÓN - INDIVIDUAL",
      ["CODIGO", "FECHA/HORA", "OPERACIÓN/PUESTO", "OFICIAL", "RESULTADO", "GPS/RIESGO", "CHECKLIST", "EVIDENCIA/PROPIEDAD", "CIERRE EJECUTIVO"],
      rows,
      `HO_BOLETA_SUPERVISION_${getSupervisionReportCode(detailedReport)}`
    )

    if (result.ok) toast({ title: "PDF individual", description: "Boleta exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  const selectedChecklist = (selectedReport?.checklist as Record<string, unknown> | undefined) ?? {}
  const selectedReasons = (selectedReport?.checklistReasons as Record<string, unknown> | undefined) ?? {}
  const selectedProperty = (selectedReport?.propertyDetails as Record<string, unknown> | undefined) ?? {}
  const selectedGps = parseSupervisionGps(selectedReport?.gps)
  const selectedPhotos = Array.isArray(selectedReport?.photos) ? (selectedReport?.photos as string[]) : []

  const handleOpenSupervisionPhoto = (photo: string) => {
    if (openDataUrlInNewTab(photo)) return
    toast({ title: "No se pudo abrir la imagen", description: "Revise si el navegador bloqueó la nueva pestaña.", variant: "destructive" })
  }

  const handleDownloadSupervisionPhoto = (photo: string, index: number) => {
    if (downloadDataUrlAsFile(photo, buildSupervisionPhotoFileName(selectedReport, index))) return
    toast({ title: "No se pudo descargar", description: "La evidencia no tiene un formato válido para descarga.", variant: "destructive" })
  }

  const handleDownloadAllSupervisionPhotos = () => {
    if (selectedPhotos.length === 0) return
    selectedPhotos.forEach((photo, index) => {
      window.setTimeout(() => {
        handleDownloadSupervisionPhoto(photo, index)
      }, index * 120)
    })
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-8 animate-in fade-in duration-300">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar registro de supervisión?"
        description="Se borrará este registro. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />

      <Dialog open={Boolean(closingFindingId)} onOpenChange={(open) => {
        if (open) return
        setClosingFindingId("")
        setCorrectiveAction("")
      }}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Cerrar hallazgo</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Registre qué se corrigió antes de confirmar el cierre.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label className="text-[9px] font-black uppercase text-white/70">Acción correctiva</Label>
            <Textarea
              value={correctiveAction}
              onChange={(event) => setCorrectiveAction(event.target.value)}
              className="min-h-28 bg-black/30 border-white/10 text-xs"
              placeholder="Describa la corrección verificada"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setClosingFindingId("")} className="border-white/20 text-white hover:bg-white/10">
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleCloseFinding()} disabled={!correctiveAction.trim() || isClosingFinding} className="bg-primary text-black font-black uppercase">
              {isClosingFinding ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <ClipboardCheck className="w-4 h-4 mr-1" />}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedReport !== null} onOpenChange={(open) => {
        if (open) return
        setSelectedReport(null)
        setSelectedFindings([])
        setCanManageSelectedFindings(false)
      }}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Detalle de Supervisión</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Vista completa del registro táctico de campo.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-[11px]">
            <div>
              <p className="text-white/50 text-[10px] uppercase">Codigo</p>
              <p className="font-black text-primary">{getSupervisionReportCode(selectedReport ?? {})}</p>
            </div>
            <div>
              <p className="text-white/50 text-[10px] uppercase">Resultado</p>
              <p className="font-black">{getExecutiveResult(selectedReport ?? {})}</p>
            </div>
            <div>
              <p className="text-white/50 text-[10px] uppercase">Cumplimiento</p>
              <p className="font-black">{getChecklistScore(selectedReport ?? {}).pct}%</p>
            </div>
            <div>
              <p className="text-white/50 text-[10px] uppercase">Evidencias</p>
              <p className="font-black">{selectedPhotos.length}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
            <div><span className="text-white/50">Fecha:</span> {formatSupervisionExportDateTime(selectedReport?.createdAt)}</div>
            <div><span className="text-white/50">Estado:</span> {getSupervisionStatusLabel(selectedReport?.status)}</div>
            <div><span className="text-white/50">Operación:</span> {String(selectedReport?.operationName ?? "—")}</div>
            <div><span className="text-white/50">Tipo:</span> {String(selectedReport?.type ?? "—")}</div>
            <div><span className="text-white/50">Oficial:</span> {String(selectedReport?.officerName ?? "—")}</div>
            <div><span className="text-white/50">Puesto:</span> {String(selectedReport?.reviewPost ?? "—")}</div>
            <div><span className="text-white/50">Cédula:</span> {String(selectedReport?.idNumber ?? "—")}</div>
            <div><span className="text-white/50">Teléfono:</span> {String(selectedReport?.officerPhone ?? "—")}</div>
            <div><span className="text-white/50">Arma:</span> {String(selectedReport?.weaponModel ?? "—")}</div>
            <div><span className="text-white/50">Serie arma:</span> {String(selectedReport?.weaponSerial ?? "—")}</div>
            <div className="md:col-span-2"><span className="text-white/50">Lugar:</span> {String(selectedReport?.lugar ?? "—")}</div>
            <div className="md:col-span-2"><span className="text-white/50">GPS:</span> {selectedGps ? `${selectedGps.lat.toFixed(6)}, ${selectedGps.lng.toFixed(6)}` : "—"}</div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <p className="text-[10px] font-black uppercase text-primary mb-2">Checklist</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div>Uniforme: {formatSupervisionYesNo(selectedChecklist.uniform)}</div>
              <div>Equipo: {formatSupervisionYesNo(selectedChecklist.equipment)}</div>
              <div>Puntualidad: {formatSupervisionYesNo(selectedChecklist.punctuality)}</div>
              <div>Servicio: {formatSupervisionYesNo(selectedChecklist.service)}</div>
            </div>
            <div className="mt-2 text-[11px]"><span className="text-white/50">Justificaciones:</span> {[selectedReasons.uniform, selectedReasons.equipment, selectedReasons.punctuality, selectedReasons.service].map((v) => String(v ?? "").trim()).filter(Boolean).join(" | ") || "—"}</div>
          </div>

          {selectedFindings.length > 0 ? (
            <div className="border-t border-white/10 pt-3 space-y-2">
              <p className="text-[10px] font-black uppercase text-primary">Hallazgos ({selectedFindings.length})</p>
              {selectedFindings.map((finding) => {
                const findingStatus = String(finding.status ?? "ABIERTO")
                const isClosed = findingStatus === "CERRADO"
                return (
                  <div key={String(finding.id ?? "")} className="rounded border border-white/10 bg-black/25 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[10px] font-black uppercase text-white">{String(finding.category ?? finding.checklist_key ?? "Hallazgo")}</p>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-black uppercase text-amber-300">{String(finding.severity ?? "—")}</span>
                        <span className={`rounded px-2 py-0.5 text-[8px] font-black uppercase ${isClosed ? "bg-green-500/15 text-green-300" : "bg-red-500/15 text-red-300"}`}>{findingStatus}</span>
                      </div>
                    </div>
                    <p className="text-[11px] text-white/80 whitespace-pre-wrap">{String(finding.description ?? "—")}</p>
                    {finding.corrective_action ? (
                      <p className="text-[10px] text-white/60"><span className="font-black uppercase">Corrección:</span> {String(finding.corrective_action)}</p>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] uppercase text-white/50">
                      <span>{finding.corrected_onsite === true ? "Corregido en sitio" : "No corregido en sitio"}</span>
                      <span>{finding.follow_up_required === true ? "Requiere seguimiento" : "Sin seguimiento"}</span>
                    </div>
                    {canManageSelectedFindings && !isClosed ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setClosingFindingId(String(finding.id ?? ""))
                          setCorrectiveAction(String(finding.corrective_action ?? ""))
                        }}
                        className="h-9 w-full border-white/20 text-white hover:bg-white/10 font-black uppercase text-[9px]"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5 mr-1" /> Cerrar hallazgo
                      </Button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          <div className="border-t border-white/10 pt-3">
            <p className="text-[10px] font-black uppercase text-primary mb-2">Propiedad</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
              <div>Luz: {String(selectedProperty.luz ?? "—")}</div>
              <div>Perímetro: {String(selectedProperty.perimetro ?? "—")}</div>
              <div>Sacate: {String(selectedProperty.sacate ?? "—")}</div>
              <div className="md:col-span-2">Daños: {String(selectedProperty.danosPropiedad ?? "—")}</div>
            </div>
          </div>

          <div className="border-t border-white/10 pt-3">
            <p className="text-[10px] font-black uppercase text-primary mb-2">Observaciones</p>
            <p className="text-[11px] text-white/80 whitespace-pre-wrap">{String(selectedReport?.observations ?? "—")}</p>
          </div>

          <div className="border-t border-white/10 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase text-primary">Evidencias ({selectedPhotos.length})</p>
              {selectedPhotos.length > 0 ? (
                <Button type="button" variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10 h-8" onClick={handleDownloadAllSupervisionPhotos}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Descargar todas
                </Button>
              ) : null}
            </div>
            {selectedPhotos.length === 0 ? (
              <p className="text-[11px] text-white/50">Sin evidencias adjuntas.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {selectedPhotos.map((photo, index) => (
                  <div key={`${photo.slice(0, 30)}-${index}`} className="space-y-2">
                    <button type="button" className="relative block aspect-square w-full rounded overflow-hidden border border-white/10" onClick={() => handleOpenSupervisionPhoto(photo)}>
                      <Image src={photo} alt={`Evidencia ${index + 1}`} fill unoptimized sizes="(max-width: 640px) 50vw, 20vw" className="object-cover" />
                    </button>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" className="flex-1 border-white/20 text-white hover:bg-white/10 h-8" onClick={() => handleOpenSupervisionPhoto(photo)}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="flex-1 border-white/20 text-white hover:bg-white/10 h-8" onClick={() => handleDownloadSupervisionPhoto(photo, index)}>
                        <Download className="w-3.5 h-3.5 mr-1" /> Bajar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canEditSupervisionStatusNotes && selectedReport ? (
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                className="border-white/20 text-amber-200 hover:bg-white/10 font-black uppercase"
                onClick={() => handleOpenEdit(selectedReport)}
              >
                Editar boleta
              </Button>
            </DialogFooter>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Editar boleta de supervisión</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              {canEditSupervisionRecords
                ? "Corrija nombre, puesto, estado o situación de la boleta."
                : "Como L2 puede ajustar estado y observaciones de la boleta."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {canEditSupervisionRecords ? (
              <>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Operacion</Label>
                  <Input value={editOperationName} onChange={(e) => setEditOperationName(e.target.value)} className="bg-black/30 border-white/10" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Oficial</Label>
                  <Input value={editOfficerName} onChange={(e) => setEditOfficerName(e.target.value)} className="bg-black/30 border-white/10" />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
                  <Input value={editReviewPost} onChange={(e) => setEditReviewPost(e.target.value)} className="bg-black/30 border-white/10" />
                </div>
              </>
            ) : null}
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUMPLIM">CUMPLIM</SelectItem>
                  <SelectItem value="CON NOVEDAD">CON NOVEDAD</SelectItem>
                  <SelectItem value="REVISIÓN PROPIEDAD">REVISIÓN PROPIEDAD</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Situacion / observaciones</Label>
              <Textarea value={editObservations} onChange={(e) => setEditObservations(e.target.value)} className="bg-black/30 border-white/10 min-h-[110px]" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => setEditOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" className="bg-primary text-black font-black uppercase" onClick={() => void handleSaveEdit()} disabled={isSavingEdit}>
              {isSavingEdit ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              Guardar cambios
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={preregisterOfficerOpen} onOpenChange={(open) => {
        if (!isPreregisteringOfficer) setPreregisterOfficerOpen(open)
      }}>
        <DialogContent className="bg-black border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Prerregistrar oficial</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              Crea una identidad operativa sin acceso al sistema. Podrá reutilizarse en futuras supervisiones.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase opacity-60">Nombre completo</Label>
              <Input
                value={preregisterOfficerName}
                onChange={(event) => setPreregisterOfficerName(event.target.value)}
                className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"
                placeholder="Nombre del oficial"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase opacity-60">Cédula / ID</Label>
              <Input
                value={preregisterOfficerIdNumber}
                onChange={(event) => setPreregisterOfficerIdNumber(normalizeIdNumberInput(event.target.value))}
                className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"
                placeholder="Ej: 1-1111-1111"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[9px] font-black uppercase opacity-60">Teléfono (opcional)</Label>
              <Input
                value={preregisterOfficerPhone}
                onChange={(event) => setPreregisterOfficerPhone(normalizePhoneInput(event.target.value))}
                className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"
                placeholder="Ej: 8888-8888"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreregisterOfficerOpen(false)} disabled={isPreregisteringOfficer}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handlePreregisterOfficer()} disabled={isPreregisteringOfficer} className="bg-primary text-black font-black uppercase">
              {isPreregisteringOfficer ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
              Guardar oficial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between mb-8 gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-tighter text-white uppercase italic flex items-center gap-3">
              Control de Supervisión
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
            <Button variant="outline" size="sm" onClick={handleUseLastRecord} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2 flex-1 sm:flex-none">
              <Plus className="w-4 h-4" /> USAR ULTIMO
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2 flex-1 sm:flex-none">
              <FileSpreadsheet className="w-4 h-4" /> EXCEL
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2 flex-1 sm:flex-none">
              <FileDown className="w-4 h-4" /> PDF
            </Button>
            <TabsList className="bg-white/5 border border-white/5 h-12 w-full sm:w-auto">
              <TabsTrigger value="list" className="text-[10px] uppercase font-black px-8">Historial</TabsTrigger>
              <TabsTrigger value="new" className="text-[10px] uppercase font-black px-8">Nueva Revision</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="list">
          <Card className="bg-[#0c0c0c] border-white/5 shadow-xl overflow-hidden">
            <CardHeader className="border-b border-white/5 px-6">
              <CardTitle className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60">Registros Tácticos de Campo</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="md:hidden p-4 space-y-3">
                {reportsLoading ? (
                  <div className="py-10 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></div>
                ) : visibleReports.length > 0 ? (
                  visibleReports.map((report) => (
                    <div key={String(report.id ?? "")} className="rounded border border-white/10 bg-black/20 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[10px] font-mono text-white/60">
                          {formatReportListDate(report.createdAt)}
                        </p>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[8px] font-black uppercase ${
                          getSupervisionStatusLabel(report.status) === "CON NOVEDAD" ? "bg-red-500/10 text-red-500" : "bg-green-500/10 text-green-500"
                        }`}>
                          {getSupervisionStatusLabel(report.status)}
                        </span>
                      </div>
                      <p className="text-[11px] font-black text-white uppercase italic">{String(report.officerName)}</p>
                      <p className="text-[10px] text-white/70 uppercase">{String(report.reviewPost)}</p>
                      <p className="text-[10px] text-white/60">Arma: {String(report.weaponModel || "N/A")}</p>
                      <p className="text-[9px] text-white/50 uppercase">CED: {String(report.idNumber || "—")} | TEL: {String(report.officerPhone || "—")}</p>
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          onClick={() => void handleOpenReport(report as unknown as Record<string, unknown>)}
                          size="sm"
                          variant="outline"
                          disabled={loadingDetailId === String(report.id)}
                          className="h-8 border-white/20 text-white hover:bg-white/10 disabled:opacity-60 flex-1"
                        >
                          {loadingDetailId === String(report.id) ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />} Ver
                        </Button>
                        <Button
                          onClick={() => void handleExportSingleExcel(report as unknown as Record<string, unknown>)}
                          size="sm"
                          variant="outline"
                          className="h-8 border-white/20 text-white hover:bg-white/10"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          onClick={() => void handleExportSinglePdf(report as unknown as Record<string, unknown>)}
                          size="sm"
                          variant="outline"
                          className="h-8 border-white/20 text-white hover:bg-white/10"
                        >
                          <FileDown className="w-3.5 h-3.5" />
                        </Button>
                        {canEditSupervisionStatusNotes ? (
                          <Button
                            onClick={() => handleOpenEdit(report as unknown as Record<string, unknown>)}
                            size="sm"
                            variant="outline"
                            className="h-8 border-white/20 text-amber-200 hover:bg-white/10"
                          >
                            Editar
                          </Button>
                        ) : null}
                        {canEditSupervisionRecords ? (
                          <Button onClick={() => setDeleteId(String(report.id ?? ""))} size="icon" variant="ghost" className="h-8 w-8 text-white/20 hover:text-destructive">
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-10 text-center text-[10px] font-black uppercase text-muted-foreground/30 italic">Sin registros tácticos</div>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-white/[0.02] border-b border-white/5">
                    <tr>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Fecha</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Oficial / Puesto</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest">Arma</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest text-center">Estatus</th>
                      <th className="px-6 py-4 text-[9px] font-black uppercase text-muted-foreground tracking-widest text-center">Detalle</th>
                      <th className="px-6 py-4 text-right"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {reportsLoading ? (
                      <tr><td colSpan={6} className="py-20 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" /></td></tr>
                    ) : visibleReports.length > 0 ? (
                      visibleReports.map((report) => (
                        <tr key={String(report.id ?? "")} className="hover:bg-white/[0.01] transition-colors border-b border-white/5">
                          <td className="px-6 py-4 text-[10px] text-white/50 font-mono">
                            {formatReportListDate(report.createdAt)}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black text-white uppercase italic">{String(report.officerName)}</span>
                              <span className="text-[9px] text-primary/80 font-black uppercase">{getSupervisionReportCode(report as unknown as Record<string, unknown>)}</span>
                              <span className="text-[9px] text-muted-foreground font-bold uppercase">{String(report.reviewPost)}</span>
                              <span className="text-[9px] text-white/50 font-bold uppercase">CED: {String(report.idNumber || "—")} | TEL: {String(report.officerPhone || "—")}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-[10px] font-bold text-white/70">
                            {String(report.weaponModel || "N/A")}
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-[8px] font-black uppercase ${
                              getSupervisionStatusLabel(report.status) === 'CON NOVEDAD' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'
                            }`}>
                              {getSupervisionStatusLabel(report.status)}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <Button
                                onClick={() => void handleOpenReport(report as unknown as Record<string, unknown>)}
                                size="sm"
                                variant="outline"
                                disabled={loadingDetailId === String(report.id)}
                                className="h-8 border-white/20 text-white hover:bg-white/10 disabled:opacity-60"
                              >
                                {loadingDetailId === String(report.id) ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Eye className="w-3.5 h-3.5 mr-1" />} Ver
                              </Button>
                              <Button
                                onClick={() => void handleExportSingleExcel(report as unknown as Record<string, unknown>)}
                                size="sm"
                                variant="outline"
                                className="h-8 border-white/20 text-white hover:bg-white/10"
                              >
                                <FileSpreadsheet className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                onClick={() => void handleExportSinglePdf(report as unknown as Record<string, unknown>)}
                                size="sm"
                                variant="outline"
                                className="h-8 border-white/20 text-white hover:bg-white/10"
                              >
                                <FileDown className="w-3.5 h-3.5" />
                              </Button>
                              {canEditSupervisionStatusNotes ? (
                                <Button
                                  onClick={() => handleOpenEdit(report as unknown as Record<string, unknown>)}
                                  size="sm"
                                  variant="outline"
                                  className="h-8 border-white/20 text-amber-200 hover:bg-white/10"
                                >
                                  Editar
                                </Button>
                              ) : null}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right">
                            {canEditSupervisionRecords ? (
                              <Button onClick={() => setDeleteId(String(report.id ?? ""))} size="icon" variant="ghost" className="h-8 w-8 text-white/20 hover:text-destructive">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr><td colSpan={6} className="py-20 text-center text-[10px] font-black uppercase text-muted-foreground/30 italic">Sin registros tácticos</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="new" className="space-y-6">
          <input
            id="supervision-photo-camera-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={handlePhotoFile}
          />
          <input
            id="supervision-photo-gallery-input"
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={handlePhotoFile}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5">
                  <CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Operación y Tipo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4 pt-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Operación</Label>
                    <Select
                      value={formData.operationName}
                      onValueChange={(value) => {
                        setFormData({
                          ...formData,
                          operationName: value,
                          // No autocompletar cliente/puesto: debe seleccionarse manualmente.
                          reviewPost: "",
                          officerRegistryId: "",
                          officerName: "",
                          idNumber: "",
                          officerPhone: "",
                        })
                      }}
                    >
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar operación" /></SelectTrigger>
                      <SelectContent>
                        {operationOptions.map((op) => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {operationOptions.length === 0 && (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Sin operaciones activas en catálogo.</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Puesto/Lugar</Label>
                    <Select
                      value={formData.reviewPost}
                      onValueChange={(value) => setFormData({
                        ...formData,
                        reviewPost: value,
                        officerRegistryId: "",
                        officerName: "",
                        idNumber: "",
                        officerPhone: "",
                      })}
                      disabled={!formData.operationName}
                    >
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder={formData.operationName ? "Seleccionar puesto/lugar" : "Primero seleccione operación"} /></SelectTrigger>
                      <SelectContent>
                        {clientOptions.map((client) => (
                          <SelectItem key={client} value={client}>{client}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formData.operationName && clientOptions.length === 0 ? (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Esta operación no tiene puestos/lugares asociados en catálogo.</p>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Tipo de Fiscalización</Label>
                    <Select onValueChange={v => setFormData({...formData, type: v as "Oficial de Seguridad" | "Propiedad"})} value={formData.type}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="Oficial de Seguridad">Oficial de Seguridad</SelectItem><SelectItem value="Propiedad">Propiedad</SelectItem></SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card className="bg-[#111111] border-white/5 tactical-card">
                <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Identificación, Lugar y Armamento</CardTitle></CardHeader>
                <CardContent className="space-y-5 pt-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Nombre del Oficial{formData.type === "Propiedad" ? " (opcional)" : ""}</Label>
                    <div className="flex items-center gap-2">
                      <Popover open={officerSearchOpen} onOpenChange={(open) => {
                        setOfficerSearchOpen(open)
                        if (!open) setOfficerSearch("")
                      }}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            aria-expanded={officerSearchOpen}
                            className="h-11 min-w-0 flex-1 justify-between border-[#1a1a1a] bg-[#0c0c0c] px-3 text-left text-xs font-bold uppercase hover:bg-[#141414]"
                          >
                            <span className="truncate">
                              {selectedOfficer
                                ? `${selectedOfficer.name} · ${selectedOfficer.personnelCode || `ID ${selectedOfficer.id.slice(0, 8).toUpperCase()}`}${selectedOfficer.source === "PREREGISTRO" ? " · PRE" : ""}`
                                : "Buscar oficial"}
                            </span>
                            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[min(420px,calc(100vw-2rem))] border-white/10 bg-[#101010] p-0 text-white">
                          <div className="flex items-center border-b border-white/10 px-3">
                            <Search className="h-4 w-4 shrink-0 text-white/45" />
                            <Input
                              autoFocus
                              value={officerSearch}
                              onChange={(event) => setOfficerSearch(event.target.value)}
                              placeholder="Nombre, código, cédula o teléfono"
                              className="h-12 border-0 bg-transparent text-xs uppercase shadow-none focus-visible:ring-0"
                            />
                          </div>
                          <div className="max-h-72 overflow-y-auto p-1">
                            {filteredOfficerOptions.length > 0 ? filteredOfficerOptions.map((officer) => (
                              <button
                                key={officer.id}
                                type="button"
                                onClick={() => handleOfficerSelect(officer.id)}
                                className="flex w-full items-center gap-3 rounded px-3 py-3 text-left hover:bg-white/10 focus:bg-white/10 focus:outline-none"
                              >
                                <Check className={`h-4 w-4 shrink-0 text-primary ${formData.officerRegistryId === officer.id ? "opacity-100" : "opacity-0"}`} />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-xs font-black uppercase text-white">{officer.name}</span>
                                  <span className="block truncate text-[9px] font-bold uppercase text-white/55">
                                    {officer.personnelCode || `ID ${officer.id.slice(0, 8).toUpperCase()}`}
                                    {officer.idNumber ? ` · CED ${officer.idNumber}` : ""}
                                    {officer.phone ? ` · TEL ${officer.phone}` : ""}
                                    {officer.source === "PREREGISTRO" ? " · PRE" : ""}
                                  </span>
                                </span>
                              </button>
                            )) : (
                              <div className="px-3 py-8 text-center text-[10px] font-bold uppercase text-white/45">
                                Sin coincidencias
                              </div>
                            )}
                          </div>
                          {!officerSearch && selectableOfficers.length > 30 ? (
                            <p className="border-t border-white/10 px-3 py-2 text-[9px] font-bold uppercase text-white/45">
                              Escriba para buscar entre {selectableOfficers.length} oficiales
                            </p>
                          ) : null}
                        </PopoverContent>
                      </Popover>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 shrink-0 border-primary/30 text-primary"
                        title="Prerregistrar oficial"
                        disabled={!selectedOperationCatalogId}
                        onClick={() => setPreregisterOfficerOpen(true)}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    {selectableOfficers.length === 0 ? (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Sin oficiales activos disponibles.</p>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Cédula / ID{formData.type === "Propiedad" ? " (opcional)" : ""}</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.idNumber} onChange={e => setFormData({...formData, idNumber: normalizeIdNumberInput(e.target.value)})} placeholder="Ej: 1-1111-1111" />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase opacity-60">Teléfono (opcional)</Label>
                      <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.officerPhone} onChange={e => setFormData({...formData, officerPhone: normalizePhoneInput(e.target.value)})} placeholder="Ej: 8888-8888" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Lugar (dirección o punto de revisión)</Label>
                    <Input className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold" value={formData.lugar} onChange={e => setFormData({...formData, lugar: e.target.value})} placeholder="Ej: Edificio A, Entrada principal" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-white/5">
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase text-primary">Modelo de Arma</Label>
                      <Select
                        value={formData.weaponModel}
                        onValueChange={(value) =>
                          setFormData({
                            ...formData,
                            weaponModel: value,
                            // Al cambiar de modelo, limpiamos serie para evitar arrastre incorrecto.
                            weaponSerial: "",
                          })
                        }
                      >
                        <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold">
                          <SelectValue placeholder="Seleccionar modelo registrado" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_WEAPON_IN_POST_OPTION}>{NO_WEAPON_IN_POST_OPTION}</SelectItem>
                          {weaponModelOptions.map((model) => (
                            <SelectItem key={model} value={model}>{model}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {weaponModelOptions.length === 0 && (
                        <p className="text-[10px] uppercase text-amber-400 font-bold">Sin modelos registrados en armamento.</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[9px] font-black uppercase text-primary">Matrícula / Serie</Label>
                      <Input
                        className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"
                        list="weapon-serial-list"
                        placeholder={
                          noWeaponInPostSelected
                            ? "NO APLICA (SIN ARMA EN EL PUESTO)"
                            : formData.weaponModel
                              ? "Seleccione o escriba matrícula/serie"
                              : "Seleccione primero el modelo"
                        }
                        value={formData.weaponSerial}
                        disabled={noWeaponInPostSelected}
                        onChange={e => setFormData({...formData, weaponSerial: normalizeWeaponSerialInput(e.target.value)})}
                      />
                      <datalist id="weapon-serial-list">
                        {weaponSerialOptions.map((serialValue) => (
                          <option key={serialValue} value={serialValue} />
                        ))}
                      </datalist>
                      {formData.weaponModel && !noWeaponInPostSelected && weaponSerialOptions.length > 0 && (
                        <p className="text-[10px] uppercase text-white/50 font-bold">Series sugeridas para este modelo: {weaponSerialOptions.length}</p>
                      )}
                      {noWeaponInPostSelected && (
                        <p className="text-[10px] uppercase text-cyan-300 font-bold">Se registrará boleta sin arma en el puesto.</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="bg-[#111111] border-white/5 tactical-card overflow-hidden h-full min-h-[400px]">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">GPX – Ubicación (hora se registra al guardar)</CardTitle></CardHeader>
              <CardContent className="p-0 h-[calc(100%-60px)] relative">
                {formData.gps ? (
                  <>
                    <TacticalMap center={[formData.gps.lng, formData.gps.lat]} zoom={16} markers={[{ lng: formData.gps.lng, lat: formData.gps.lat, color: '#F59E0B' }]} className="w-full h-full" />
                    <div className="absolute top-2 left-2 z-20 bg-black/75 border border-white/15 rounded px-2 py-1 text-[9px] font-black uppercase text-white/80">
                      Precision GPS: {Math.round(Number(formData.gps.accuracy ?? 0))} m
                    </div>
                    <div className="absolute bottom-2 right-2 z-20">
                      <Button type="button" onClick={handleGetGPS} disabled={isLocating} variant="outline" className="border-white/20 bg-black/70 text-white hover:bg-black/90 font-black uppercase text-[9px] h-9 px-3">
                        {isLocating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <MapPin className="w-3.5 h-3.5 mr-1" />}
                        Actualizar GPS
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center space-y-4">
                    <Button type="button" onClick={handleGetGPS} disabled={isLocating} variant="outline" className="border-white/10 text-white font-black uppercase text-[10px] h-11 px-8">
                      {isLocating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
                      Capturar Coordenadas GPS
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {formData.type === "Propiedad" ? (
            <Card className="bg-[#111111] border-white/5 tactical-card lg:col-span-2">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Revisión de Propiedad</CardTitle></CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">¿Cómo está la luz?</Label>
                    <Select value={formData.propertyDetails.luz} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, luz: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Bien">Bien (encendida, sin fallas)</SelectItem>
                        <SelectItem value="Mal">Mal (intermitente o fallando)</SelectItem>
                        <SelectItem value="Apagada">Apagada / sin luz</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Estado del perímetro</Label>
                    <Select value={formData.propertyDetails.perimetro} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, perimetro: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Correcto">Correcto (cerrado, sin daños)</SelectItem>
                        <SelectItem value="Dañado">Dañado o abierto</SelectItem>
                        <SelectItem value="No aplica">No aplica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Estado del césped / sacate</Label>
                    <Select value={formData.propertyDetails.sacate} onValueChange={v => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, sacate: v }})}>
                      <SelectTrigger className="bg-[#0c0c0c] border-[#1a1a1a] h-11 uppercase text-xs font-bold"><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Cortado">Cortado (en orden)</SelectItem>
                        <SelectItem value="Alto">Alto o descuidado</SelectItem>
                        <SelectItem value="Regular">Regular</SelectItem>
                        <SelectItem value="No aplica">No aplica</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-2 space-y-2">
                    <Label className="text-[9px] font-black uppercase opacity-60">Daños a la propiedad (descripción)</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[80px] uppercase text-xs" value={formData.propertyDetails.danosPropiedad} onChange={e => setFormData({...formData, propertyDetails: { ...formData.propertyDetails, danosPropiedad: e.target.value }})} placeholder="Describa daños observados, si los hay..." />
                  </div>
                </div>
                <div className="pt-4 border-t border-white/5 space-y-6">
                  <div className="space-y-4">
                    <Label className="text-[10px] font-black uppercase opacity-60">Evidencia Fotográfica (lugar, GPX y hora se registran automáticamente)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                      {photos.map((photo, i) => (
                        <div key={i} className="relative aspect-square rounded overflow-hidden border border-white/10 group">
                          <Image src={photo} alt="Evidencia" fill unoptimized sizes="(max-width: 640px) 50vw, 16vw" className="object-cover" />
                          <button type="button" onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3 text-white" /></button>
                        </div>
                      ))}
                      <Button asChild variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60">
                        <label htmlFor="supervision-photo-camera-input" onClick={handlePreparePhotoPicker}><Camera className="w-5 h-5 text-white/40" /></label>
                      </Button>
                      <Button asChild variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60">
                        <label htmlFor="supervision-photo-gallery-input" onClick={handlePreparePhotoPicker}><Plus className="w-5 h-5 text-white/40" /></label>
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase opacity-60">Observaciones Generales</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[100px] uppercase text-xs" value={formData.observations} onChange={e => setFormData({...formData, observations: e.target.value})} />
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 pt-4">
                    <Button type="button" variant="ghost" onClick={() => setActiveTab("list")} className="flex-1 h-14 font-black uppercase text-[10px]">Cancelar</Button>
                    <Button type="button" onClick={handleAddReport} disabled={isSaving} className="flex-[2] h-14 bg-primary text-black font-black uppercase tracking-widest text-[11px] disabled:opacity-60">
                      {isSaving ? "Guardando..." : "Guardar Fiscalización de Campo"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="bg-[#111111] border-white/5 tactical-card lg:col-span-2">
              <CardHeader className="border-b border-white/5"><CardTitle className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">Auditoría de Estándares</CardTitle></CardHeader>
              <CardContent className="space-y-8 pt-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {SUPERVISION_CHECKLIST_ITEMS.map((item) => {
                    const entry = formData.checklistEntries[item.id]
                    return (
                    <div key={item.id} className="space-y-3 p-4 bg-black/30 rounded border border-white/5">
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black uppercase text-white">{item.label}</Label>
                        <div className="grid grid-cols-3 gap-1 rounded border border-white/10 bg-black/30 p-1">
                          {([
                            ["CONFORME", "Conforme"],
                            ["NO_CONFORME", "No conforme"],
                            ["NO_APLICA", "N/A"],
                          ] as const).map(([value, label]) => (
                            <Button
                              key={value}
                              type="button"
                              variant="ghost"
                              onClick={() => setFormData((current) => ({
                                ...current,
                                checklistEntries: {
                                  ...current.checklistEntries,
                                  [item.id]: { ...current.checklistEntries[item.id], status: value as SupervisionChecklistStatus },
                                },
                              }))}
                              className={`h-9 px-1 text-[9px] font-black uppercase ${entry.status === value ? (value === "NO_CONFORME" ? "bg-red-500/20 text-red-200" : "bg-primary text-black") : "text-white/50 hover:text-white"}`}
                            >
                              {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {entry.status === "NO_CONFORME" && (
                        <div className="space-y-3 animate-in slide-in-from-top-2 duration-200">
                          <div className="space-y-1.5">
                            <Label className="text-[8px] font-black uppercase text-red-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> Descripción del hallazgo</Label>
                            <Textarea
                              className="bg-[#0c0c0c] border-red-500/30 text-[10px] uppercase min-h-20"
                              value={entry.description}
                              onChange={(event) => setFormData((current) => ({
                                ...current,
                                checklistEntries: {
                                  ...current.checklistEntries,
                                  [item.id]: { ...current.checklistEntries[item.id], description: event.target.value },
                                },
                              }))}
                              placeholder="Describa qué encontró"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[8px] font-black uppercase text-white/60">Severidad</Label>
                            <Select
                              value={entry.severity}
                              onValueChange={(severity) => setFormData((current) => ({
                                ...current,
                                checklistEntries: {
                                  ...current.checklistEntries,
                                  [item.id]: { ...current.checklistEntries[item.id], severity: severity as SupervisionChecklistEntry["severity"] },
                                },
                              }))}
                            >
                              <SelectTrigger className="h-10 bg-[#0c0c0c] border-white/10 text-[10px] font-bold uppercase"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="BAJA">Baja</SelectItem>
                                <SelectItem value="MEDIA">Media</SelectItem>
                                <SelectItem value="ALTA">Alta</SelectItem>
                                <SelectItem value="CRITICA">Crítica</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="flex min-h-10 items-center gap-2 rounded border border-white/10 px-3 text-[9px] font-black uppercase text-white/70">
                              <Checkbox
                                checked={entry.correctedOnsite}
                                onCheckedChange={(checked) => setFormData((current) => ({
                                  ...current,
                                  checklistEntries: {
                                    ...current.checklistEntries,
                                    [item.id]: { ...current.checklistEntries[item.id], correctedOnsite: checked === true },
                                  },
                                }))}
                              />
                              Corregido en sitio
                            </label>
                            <label className="flex min-h-10 items-center gap-2 rounded border border-white/10 px-3 text-[9px] font-black uppercase text-white/70">
                              <Checkbox
                                checked={entry.followUpRequired}
                                onCheckedChange={(checked) => setFormData((current) => ({
                                  ...current,
                                  checklistEntries: {
                                    ...current.checklistEntries,
                                    [item.id]: { ...current.checklistEntries[item.id], followUpRequired: checked === true },
                                  },
                                }))}
                              />
                              Requiere seguimiento
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  )})}
                </div>

                <div className="pt-4 border-t border-white/5 space-y-6">
                  <div className="space-y-4">
                    <Label className="text-[10px] font-black uppercase opacity-60">Evidencia Fotográfica (Múltiple)</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
                      {photos.map((photo, i) => (
                        <div key={i} className="relative aspect-square rounded overflow-hidden border border-white/10 group">
                          <Image src={photo} alt="Evidencia" fill unoptimized sizes="(max-width: 640px) 50vw, 16vw" className="object-cover" />
                          <button type="button" onClick={() => removePhoto(i)} className="absolute top-1 right-1 bg-red-600 p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><X className="w-3 h-3 text-white" /></button>
                        </div>
                      ))}
                      <Button asChild variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60">
                        <label htmlFor="supervision-photo-camera-input" onClick={handlePreparePhotoPicker}><Camera className="w-5 h-5 text-white/40" /></label>
                      </Button>
                      <Button asChild variant="outline" className="aspect-square h-auto border-dashed border-white/10 bg-black/40 hover:bg-black/60">
                        <label htmlFor="supervision-photo-gallery-input" onClick={handlePreparePhotoPicker}><Plus className="w-5 h-5 text-white/40" /></label>
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black uppercase opacity-60">Observaciones Generales</Label>
                    <Textarea className="bg-[#0c0c0c] border-[#1a1a1a] min-h-[100px] uppercase text-xs" value={formData.observations} onChange={e => setFormData({...formData, observations: e.target.value})} />
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-4 pt-4">
                  <Button type="button" variant="ghost" onClick={() => setActiveTab("list")} className="flex-1 h-14 font-black uppercase text-[10px]">Cancelar</Button>
                  <Button type="button" onClick={handleAddReport} disabled={isSaving} className="flex-[2] h-14 bg-primary text-black font-black uppercase tracking-widest text-[11px] disabled:opacity-60">
                    {isSaving ? "Guardando..." : "Guardar Fiscalización de Campo"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={aiSummaryOpen} onOpenChange={setAiSummaryOpen}>
        <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-300" /> Resumen IA de supervisión
            </DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">
              {aiSummaryReportCode ? `Boleta ${aiSummaryReportCode}` : "Análisis operativo"}
            </DialogDescription>
          </DialogHeader>

          {aiSummaryLoadingId ? (
            <div className="h-24 flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin text-purple-300" />
            </div>
          ) : (
            <div className="rounded border border-white/10 bg-black/30 p-3 max-h-[60vh] overflow-y-auto">
              <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/90 font-sans">
                {aiSummaryText || "Sin contenido."}
              </pre>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
