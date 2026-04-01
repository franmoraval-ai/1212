"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { 
  Building2,
  Users, 
  Search, 
  Plus, 
  Phone,
  ShieldCheck,
  Loader2,
  Trash2,
  ShieldAlert,
  FileSpreadsheet,
  FileDown,
  KeyRound,
  IdCard,
  SmartphoneNfc
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { validateStrongPassword } from "@/lib/password-policy"
import { runMutationWithOffline } from "@/lib/offline-mutations"
import { hasPermission } from "@/lib/access-control"
import { extractNfcToken } from "@/lib/nfc"
import { buildAssignedScope, splitAssignedScope } from "@/lib/personnel-assignment"

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

const OPS_LIMITED_PROFILE = ["restricted_access", "personnel_view", "personnel_create", "supervision_grouped_view", "rounds_access"] as const
const DATA_MANAGER_PROFILE = ["restricted_access", "personnel_view", "supervision_grouped_view", "rounds_access", "data_ops_manage"] as const

function formatHoursValue(hours: number) {
  if (!Number.isFinite(hours) || hours <= 0) return "0 h"
  return `${hours.toFixed(hours >= 100 ? 0 : 1)} h`
}

function formatWorkedDuration(minutes: number) {
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

export default function PersonnelPage() {
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const canCreateUsers = (user?.roleLevel ?? 1) >= 4 || hasPermission(user?.customPermissions, "personnel_create")
  const canManageUsers = (user?.roleLevel ?? 1) >= 4
  const canAssignL4 = canManageUsers
  const maxCreatableRole = canManageUsers ? 4 : (canCreateUsers ? 2 : 0)
  const [isOpen, setIsOpen] = useState(false)
  const [createStep, setCreateStep] = useState<1 | 2>(1)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [filterLevel, setFilterLevel] = useState<string>("TODOS")
  const [selectedOperation, setSelectedOperation] = useState("")
  const [selectedPost, setSelectedPost] = useState("")
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false)
  const [assignmentUserId, setAssignmentUserId] = useState("")
  const [assignmentUserLabel, setAssignmentUserLabel] = useState("")
  const [assignmentOperation, setAssignmentOperation] = useState("")
  const [assignmentPost, setAssignmentPost] = useState("")
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [credentialDialogOpen, setCredentialDialogOpen] = useState(false)
  const [credentialUserId, setCredentialUserId] = useState("")
  const [credentialUserLabel, setCredentialUserLabel] = useState("")
  const [credentialShiftPin, setCredentialShiftPin] = useState("")
  const [credentialShiftNfcCode, setCredentialShiftNfcCode] = useState("")
  const [credentialSaving, setCredentialSaving] = useState(false)
  const [createNfcScanning, setCreateNfcScanning] = useState(false)
  const [credentialNfcScanning, setCredentialNfcScanning] = useState(false)
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummaryResponse | null>(null)
  const [attendanceLoading, setAttendanceLoading] = useState(false)
  const [attendanceMessage, setAttendanceMessage] = useState<string | null>(null)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<AttendanceOfficerSummary | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    temporaryPassword: "",
    role_level: "1",
    status: "Activo",
    assigned: "",
    shiftPin: "",
    shiftNfcCode: "",
    accessProfile: "DEFAULT",
  })

  const { data: operationsCatalog } = useCollection<OperationCatalogRow>(
    user ? "operation_catalog" : null,
    { orderBy: "operation_name", orderDesc: false, realtime: false, pollingMs: 180000 }
  )

  const { data: personnel, isLoading: loading } = useCollection(user ? "users" : null, {
    orderBy: "role_level",
    orderDesc: true,
    realtime: false,
    pollingMs: 120000,
  })

  const ONLINE_WINDOW_MS = 2 * 60 * 1000
  const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window

  const loadAttendanceSummary = useCallback(async () => {
    if (!user) return
    setAttendanceLoading(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      let accessToken = String(sessionData.session?.access_token ?? "").trim()
      if (!accessToken) {
        const { data: refreshed } = await supabase.auth.refreshSession()
        accessToken = String(refreshed.session?.access_token ?? "").trim()
      }

      const response = await fetch("/api/personnel/attendance-summary?days=30", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        credentials: "include",
      })

      const result = (await response.json()) as AttendanceSummaryResponse
      if (!response.ok) {
        setAttendanceMessage(String(result.error ?? "No se pudieron cargar métricas RH."))
        setAttendanceSummary(null)
        return
      }

      setAttendanceSummary(result)
      setAttendanceMessage(null)
    } catch {
      setAttendanceMessage("No se pudieron cargar métricas RH.")
      setAttendanceSummary(null)
    } finally {
      setAttendanceLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    if (!user) return
    void loadAttendanceSummary()
  }, [loadAttendanceSummary, user])

  const getLastSeenDate = (p: Record<string, unknown>) => {
    const value = p.lastSeen ?? p.last_seen
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value === "string") {
      const parsed = new Date(value)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
    if (
      typeof value === "object" &&
      value !== null &&
      "toDate" in value &&
      typeof (value as { toDate?: () => Date }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate()
    }
    return null
  }

  const isUserOnlineNow = (p: Record<string, unknown>) => {
    const isOnlineFlag = Boolean(p.isOnline ?? p.is_online)
    const lastSeen = getLastSeenDate(p)
    if (!isOnlineFlag || !lastSeen) return false
    return Date.now() - lastSeen.getTime() <= ONLINE_WINDOW_MS
  }

  const formatLastSeen = (p: Record<string, unknown>) => {
    if (isUserOnlineNow(p)) return "En linea ahora"
    const lastSeen = getLastSeenDate(p)
    if (!lastSeen) return "Sin actividad reciente"
    const diffMs = Date.now() - lastSeen.getTime()
    const diffMin = Math.max(1, Math.floor(diffMs / 60000))
    if (diffMin < 60) return `Visto hace ${diffMin} min`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `Visto hace ${diffHours} h`
    const diffDays = Math.floor(diffHours / 24)
    return `Visto hace ${diffDays} d`
  }

  const onlinePersonnel = (personnel ?? []).filter((p) => isUserOnlineNow(p as unknown as Record<string, unknown>))

  const getRoleLevel = (p: Record<string, unknown>) => Number(p.roleLevel ?? p.role_level ?? 1)

  const filteredPersonnel = (personnel ?? []).filter((p) => {
    const matchSearch = !searchTerm.trim() ||
      (String(p.firstName ?? "").toLowerCase().includes(searchTerm.toLowerCase())) ||
      (String(p.email ?? "").toLowerCase().includes(searchTerm.toLowerCase()))
    const matchLevel = filterLevel === "TODOS" || String(getRoleLevel(p as unknown as Record<string, unknown>)) === filterLevel
    return matchSearch && matchLevel
  })

  const attendanceByOfficer = useMemo(() => {
    const entries = attendanceSummary?.officers ?? []
    return new Map(entries.map((entry) => [entry.officerUserId, entry]))
  }, [attendanceSummary])

  const activeL1Summary = useMemo(() => {
    const entries = attendanceSummary?.officers ?? []
    return entries.filter((entry) => String(entry.status).trim().toLowerCase() !== "inactivo")
  }, [attendanceSummary])

  const operationOptions = useMemo(() => {
    const ops = new Set<string>()
    for (const item of operationsCatalog ?? []) {
      if (item.isActive === false) continue
      const value = String(item.operationName ?? "").trim()
      if (value) ops.add(value)
    }
    return Array.from(ops).sort((a, b) => a.localeCompare(b))
  }, [operationsCatalog])

  const postOptions = useMemo(() => {
    const posts = new Set<string>()
    for (const item of operationsCatalog ?? []) {
      if (item.isActive === false) continue
      const operationName = String(item.operationName ?? "").trim()
      if (selectedOperation && operationName !== selectedOperation) continue
      const value = String(item.clientName ?? "").trim()
      if (value) posts.add(value)
    }
    return Array.from(posts).sort((a, b) => a.localeCompare(b))
  }, [operationsCatalog, selectedOperation])

  const assignmentPostOptions = useMemo(() => {
    const posts = new Set<string>()
    for (const item of operationsCatalog ?? []) {
      if (item.isActive === false) continue
      const operationName = String(item.operationName ?? "").trim()
      if (assignmentOperation && operationName !== assignmentOperation) continue
      const value = String(item.clientName ?? "").trim()
      if (value) posts.add(value)
    }
    return Array.from(posts).sort((a, b) => a.localeCompare(b))
  }, [assignmentOperation, operationsCatalog])

  const openOfficerProfile = (person: Record<string, unknown>) => {
    const summary = attendanceByOfficer.get(String(person.id ?? ""))
    if (!summary) {
      toast({ title: "Sin métricas", description: "Este oficial aún no tiene horas registradas en los últimos 30 días." })
      return
    }
    setSelectedProfile(summary)
    setProfileDialogOpen(true)
  }

  const resetCreateForm = () => {
    setFormData({ name: "", email: "", temporaryPassword: "", role_level: "1", status: "Activo", assigned: "", shiftPin: "", shiftNfcCode: "", accessProfile: "DEFAULT" })
    setSelectedOperation("")
    setSelectedPost("")
    setCreateStep(1)
  }

  const handleCreateDialogOpenChange = (open: boolean) => {
    setIsOpen(open)
    if (!open) resetCreateForm()
  }

  const handleAddPersonnel = async () => {
    if (!canCreateUsers) {
      toast({ title: "Sin permisos", description: "No tiene permiso para incorporar oficiales.", variant: "destructive" })
      return
    }
    if (!formData.name || !formData.email || !formData.temporaryPassword) {
      toast({ title: "Error", description: "Nombre, correo y clave temporal son obligatorios.", variant: "destructive" })
      return
    }
    const validation = validateStrongPassword(formData.temporaryPassword)
    if (!validation.ok) {
      toast({ title: "Error", description: validation.message, variant: "destructive" })
      return
    }
    if (parseInt(formData.role_level, 10) === 4 && !canAssignL4) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede asignar nivel 4.", variant: "destructive" })
      return
    }
    if (parseInt(formData.role_level, 10) > maxCreatableRole) {
      toast({ title: "Sin permisos", description: `Su perfil solo puede crear hasta L${maxCreatableRole}.`, variant: "destructive" })
      return
    }
    if (formData.accessProfile !== "DEFAULT" && !canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede asignar perfiles especiales.", variant: "destructive" })
      return
    }
    if (parseInt(formData.role_level, 10) === 1 && (!selectedOperation || !selectedPost)) {
      toast({ title: "Datos incompletos", description: "Para L1 seleccione una base operativa inicial del Centro Operativo.", variant: "destructive" })
      return
    }

    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = sessionData.session?.access_token
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = refreshed.session?.access_token
    }

    const response = await fetch("/api/personnel/create-user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        name: formData.name,
        email: formData.email,
        temporaryPassword: formData.temporaryPassword,
        role_level: parseInt(formData.role_level, 10),
        status: formData.status,
        assigned: parseInt(formData.role_level, 10) === 1 ? `${selectedOperation} | ${selectedPost}` : formData.assigned,
        shiftPin: formData.shiftPin,
        shiftNfcCode: formData.shiftNfcCode,
        customPermissions:
          formData.accessProfile === "OPS_LIMITED"
            ? [...OPS_LIMITED_PROFILE]
            : formData.accessProfile === "DATA_MANAGER"
              ? [...DATA_MANAGER_PROFILE]
              : [],
      }),
    })

    const result = (await response.json()) as { error?: string }
    if (!response.ok) {
      if (response.status === 409) {
        toast({
          title: "Correo ya existente",
          description: result.error || "Ese correo ya existe. Use recuperacion de clave.",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Error", description: result.error || "No se pudo crear el usuario.", variant: "destructive" })
      return
    }

    toast({
      title: "Usuario creado",
      description: `${formData.name} fue creado con clave temporal. Debe cambiarla desde "¿Olvidó su clave táctica?".`,
    })
    setIsOpen(false)
    resetCreateForm()
  }

  const handleOpenCredentialDialog = (person: Record<string, unknown>) => {
    setCredentialUserId(String(person.id ?? ""))
    setCredentialUserLabel(String(person.firstName ?? person.email ?? "Oficial"))
    setCredentialShiftPin("")
    setCredentialShiftNfcCode("")
    setCredentialDialogOpen(true)
  }

  const handleOpenAssignmentDialog = (person: Record<string, unknown>) => {
    const parsed = splitAssignedScope(person.assigned)
    setAssignmentUserId(String(person.id ?? ""))
    setAssignmentUserLabel(String(person.firstName ?? person.email ?? "Oficial"))
    setAssignmentOperation(parsed.operationName)
    setAssignmentPost(parsed.postName)
    setAssignmentDialogOpen(true)
  }

  const handleSaveAssignment = async () => {
    if (!assignmentUserId) return
    setAssignmentSaving(true)

    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = sessionData.session?.access_token
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = refreshed.session?.access_token
    }

    const response = await fetch("/api/personnel/assignment", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        userId: assignmentUserId,
        operationName: assignmentOperation,
        postName: assignmentPost,
      }),
    })

    const result = (await response.json()) as { error?: string }
    setAssignmentSaving(false)
    if (!response.ok) {
      toast({ title: "Error", description: result.error || "No se pudo actualizar puesto/operación.", variant: "destructive" })
      return
    }

    toast({ title: "Base operativa actualizada", description: buildAssignedScope(assignmentOperation, assignmentPost) })
    setAssignmentDialogOpen(false)
  }

  const startPersonnelNfcScan = async (target: "create" | "credentials") => {
    if (!nfcSupported) {
      toast({ title: "NFC no disponible", description: "Este navegador o dispositivo no soporta lectura NFC web.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: () => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detectó lector NFC en el navegador.", variant: "destructive" })
      return
    }

    const setScanning = target === "create" ? setCreateNfcScanning : setCredentialNfcScanning

    try {
      setScanning(true)
      const reader = new NdefCtor()
      await reader.scan()
      reader.onreading = (event) => {
        const token = extractNfcToken(event)
        if (!token) return
        if (target === "create") {
          setFormData((current) => ({ ...current, shiftNfcCode: token }))
        } else {
          setCredentialShiftNfcCode(token)
        }
        setScanning(false)
        toast({ title: "NFC capturado", description: "Código leído correctamente desde la etiqueta." })
      }
      reader.onreadingerror = () => {
        setScanning(false)
        toast({ title: "Error NFC", description: "No se pudo leer la etiqueta NFC.", variant: "destructive" })
      }
    } catch {
      setScanning(false)
      toast({ title: "Error NFC", description: "No se pudo iniciar la lectura NFC.", variant: "destructive" })
    }
  }

  const handleSaveShiftCredentials = async () => {
    if (!credentialUserId) return
    setCredentialSaving(true)

    const { data: sessionData } = await supabase.auth.getSession()
    let accessToken = sessionData.session?.access_token
    if (!accessToken) {
      const { data: refreshed } = await supabase.auth.refreshSession()
      accessToken = refreshed.session?.access_token
    }

    const response = await fetch("/api/personnel/shift-credentials", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify({
        userId: credentialUserId,
        shiftPin: credentialShiftPin,
        shiftNfcCode: credentialShiftNfcCode,
      }),
    })

    const result = (await response.json()) as { error?: string }
    setCredentialSaving(false)
    if (!response.ok) {
      toast({ title: "Error", description: result.error || "No se pudieron guardar credenciales.", variant: "destructive" })
      return
    }

    toast({ title: "Credenciales actualizadas", description: "PIN/NFC de relevo guardados correctamente." })
    setCredentialDialogOpen(false)
  }

  const handleUpdateRole = async (id: string, role_level: number) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede cambiar niveles.", variant: "destructive" })
      return
    }
    if (role_level === 4 && !canAssignL4) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede asignar nivel 4.", variant: "destructive" })
      return
    }
    try {
      const result = await runMutationWithOffline(supabase, {
        table: "users",
        action: "update",
        payload: { role_level },
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Cambio en cola" : "Nivel actualizado",
        description: result.queued ? "Se aplicara al reconectar." : "El rol del usuario se actualizó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleUpdateStatus = async (id: string, status: string) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede cambiar estados.", variant: "destructive" })
      return
    }
    try {
      const result = await runMutationWithOffline(supabase, {
        table: "users",
        action: "update",
        payload: { status },
        match: { id },
      })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Cambio en cola" : "Estado actualizado",
        description: result.queued ? "Se aplicara al reconectar." : "El estado se actualizó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo actualizar.", variant: "destructive" })
    }
  }

  const handleDelete = async (id: string) => {
    if (!canManageUsers) {
      toast({ title: "Sin permisos", description: "Solo nivel 4 puede eliminar usuarios.", variant: "destructive" })
      return
    }
    setIsDeleting(true)
    try {
      const result = await runMutationWithOffline(supabase, { table: "users", action: "delete", match: { id } })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Eliminacion en cola" : "Eliminado",
        description: result.queued ? "Se eliminara al reconectar." : "El personal se eliminó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleExportExcel = async () => {
    const { exportToExcel } = await import("@/lib/export-utils")
    const rows = (filteredPersonnel.length ? filteredPersonnel : personnel || []).map((p) => ({
      horas30d: attendanceByOfficer.get(String(p.id ?? ""))?.totalWorkedHours ?? 0,
      dias30d: attendanceByOfficer.get(String(p.id ?? ""))?.workedDays ?? 0,
      nombre: p.firstName || "—",
      email: p.email || "—",
      nivel: `L${getRoleLevel(p as unknown as Record<string, unknown>)}`,
      estado: p.status || "—",
      asignado: p.assigned || "—",
    }))
    const result = await exportToExcel(rows, "Personal", [
      { header: "NOMBRE", key: "nombre", width: 25 },
      { header: "EMAIL", key: "email", width: 30 },
      { header: "NIVEL", key: "nivel", width: 8 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "ASIGNADO", key: "asignado", width: 20 },
      { header: "HORAS 30D", key: "horas30d", width: 12 },
      { header: "DIAS 30D", key: "dias30d", width: 12 },
    ], "HO_PERSONAL")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = async () => {
    const { exportToPdf } = await import("@/lib/export-utils")
    const toExport = filteredPersonnel.length ? filteredPersonnel : personnel || []
    const rows = toExport.map((p) => [
      String(p.firstName || "—").slice(0, 20),
      String(p.email || "—").slice(0, 28),
      `L${getRoleLevel(p as unknown as Record<string, unknown>)}`,
      String(p.status || "—"),
      String(p.assigned || "—").slice(0, 15),
      String(attendanceByOfficer.get(String(p.id ?? ""))?.totalWorkedHours ?? 0),
      String(attendanceByOfficer.get(String(p.id ?? ""))?.workedDays ?? 0),
    ]) as (string | number)[][]
    const result = await exportToPdf("PERSONAL", ["NOMBRE", "EMAIL", "NIVEL", "ESTADO", "ASIGNADO", "HORAS 30D", "DIAS 30D"], rows, "HO_PERSONAL")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  const isCreateStepOneValid = Boolean(formData.name.trim() && formData.email.trim() && formData.temporaryPassword.trim())
  const isL1Draft = formData.role_level === "1"
  const draftRoleLabel = formData.role_level === "1"
    ? "L1 Oficial Operativo"
    : formData.role_level === "2"
      ? "L2 Supervisor"
      : formData.role_level === "3"
        ? "L3 Gerente"
        : "L4 Director"

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar personal?"
        description="Se borrará este registro de la fuerza. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <Dialog open={assignmentDialogOpen} onOpenChange={setAssignmentDialogOpen}>
        <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black uppercase italic text-xl">Base operativa L1</DialogTitle>
            <DialogDescription className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
              {assignmentUserLabel} · La autorización real por puesto se administra en Centro Operativo.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-[10px] uppercase font-black text-primary">Operación base</Label>
              <Select value={assignmentOperation} onValueChange={(value) => { setAssignmentOperation(value); setAssignmentPost("") }}>
                <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue placeholder="Seleccionar operación" /></SelectTrigger>
                <SelectContent>
                  {operationOptions.map((operation) => (
                    <SelectItem key={operation} value={operation}>{operation}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label className="text-[10px] uppercase font-black text-primary">Puesto base</Label>
              <Select value={assignmentPost} onValueChange={setAssignmentPost} disabled={!assignmentOperation}>
                <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue placeholder="Seleccionar puesto" /></SelectTrigger>
                <SelectContent>
                  {assignmentPostOptions.map((post) => (
                    <SelectItem key={post} value={post}>{post}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveAssignment} className="w-full bg-primary text-black font-black h-12 uppercase tracking-widest" disabled={assignmentSaving || !assignmentOperation || !assignmentPost}>
              {assignmentSaving ? "Guardando..." : "Guardar base operativa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={credentialDialogOpen} onOpenChange={setCredentialDialogOpen}>
        <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-black uppercase italic text-xl">Credenciales de relevo</DialogTitle>
            <DialogDescription className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
              {credentialUserLabel}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label className="text-[10px] uppercase font-black text-primary">PIN relevo</Label>
              <Input value={credentialShiftPin} onChange={e => setCredentialShiftPin(e.target.value.replace(/\D/g, ""))} className="bg-white/5 border-white/10 h-11" placeholder="4 a 8 dígitos" inputMode="numeric" />
            </div>
            <div className="grid gap-2">
              <Label className="text-[10px] uppercase font-black text-primary">Código NFC</Label>
              <div className="flex gap-2">
                <Input value={credentialShiftNfcCode} onChange={e => setCredentialShiftNfcCode(e.target.value)} className="bg-white/5 border-white/10 h-11" placeholder="Etiqueta o código NFC" />
                <Button type="button" variant="outline" className="border-white/10" onClick={() => void startPersonnelNfcScan("credentials")} disabled={!nfcSupported || credentialNfcScanning}>
                  {credentialNfcScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <SmartphoneNfc className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSaveShiftCredentials} className="w-full bg-primary text-black font-black h-12 uppercase tracking-widest" disabled={credentialSaving}>
              {credentialSaving ? "Guardando..." : "Guardar credenciales"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-black uppercase italic text-xl">Perfil RH del oficial</DialogTitle>
            <DialogDescription className="text-muted-foreground text-[10px] uppercase font-bold tracking-widest">
              Ventana operacional de 30 días
            </DialogDescription>
          </DialogHeader>
          {selectedProfile ? (
            <div className="space-y-4 py-2">
              <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-4 space-y-1">
                <p className="text-lg font-black uppercase text-white">{selectedProfile.officerName}</p>
                <p className="text-[10px] uppercase text-white/60">{selectedProfile.officerEmail || "Sin correo"} · {selectedProfile.assigned || "Sin puesto"}</p>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card className="bg-white/5 border-white/10"><CardContent className="p-3"><p className="text-[10px] uppercase text-white/50">Horas</p><p className="text-xl font-black text-white">{formatHoursValue(selectedProfile.totalWorkedHours)}</p></CardContent></Card>
                <Card className="bg-white/5 border-white/10"><CardContent className="p-3"><p className="text-[10px] uppercase text-white/50">Días</p><p className="text-xl font-black text-white">{selectedProfile.workedDays}</p></CardContent></Card>
                <Card className="bg-white/5 border-white/10"><CardContent className="p-3"><p className="text-[10px] uppercase text-white/50">Turnos cerrados</p><p className="text-xl font-black text-white">{selectedProfile.completedShifts}</p></CardContent></Card>
                <Card className="bg-white/5 border-white/10"><CardContent className="p-3"><p className="text-[10px] uppercase text-white/50">Turnos abiertos</p><p className="text-xl font-black text-white">{selectedProfile.openShifts}</p></CardContent></Card>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded border border-white/10 bg-white/5 p-3 space-y-1">
                  <p className="text-[10px] uppercase font-black text-white/50">Última entrada</p>
                  <p className="text-sm font-black uppercase text-white">{formatDateTime(selectedProfile.lastCheckInAt)}</p>
                </div>
                <div className="rounded border border-white/10 bg-white/5 p-3 space-y-1">
                  <p className="text-[10px] uppercase font-black text-white/50">Última salida</p>
                  <p className="text-sm font-black uppercase text-white">{formatDateTime(selectedProfile.lastCheckOutAt)}</p>
                </div>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3 space-y-2">
                <p className="text-[10px] uppercase font-black text-white/50">Puestos recientes</p>
                <p className="text-sm text-white">{selectedProfile.recentPosts.join(" · ") || "Sin puestos registrados"}</p>
              </div>
              <div className="rounded border border-white/10 bg-white/5 p-3 space-y-2">
                <p className="text-[10px] uppercase font-black text-white/50">Turnos recientes</p>
                {selectedProfile.recentShifts.length === 0 ? (
                  <p className="text-sm text-white/60 uppercase">Sin turnos en la ventana consultada.</p>
                ) : (
                  <div className="space-y-2">
                    {selectedProfile.recentShifts.map((shift) => (
                      <div key={shift.id} className="rounded border border-white/10 bg-black/30 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-black uppercase text-white">{shift.stationPostName || shift.stationLabel || "Puesto"}</p>
                          <span className="text-[10px] uppercase text-cyan-300 font-black">{shift.isOpen ? "En turno" : formatWorkedDuration(shift.workedMinutes)}</span>
                        </div>
                        <p className="text-[10px] uppercase text-white/55">Entrada: {formatDateTime(shift.checkInAt)}</p>
                        <p className="text-[10px] uppercase text-white/45">Salida: {formatDateTime(shift.checkOutAt)}</p>
                        {shift.notes ? <p className="text-sm text-white/80 whitespace-pre-wrap mt-2">{shift.notes}</p> : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <div className="scanline" />
      
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">
            OFICIALES Y CREDENCIALES
          </h1>
          <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
            Perfiles, credenciales de relevo y base inicial. Los puestos se administran aparte.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nombre o email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-[200px] h-10 bg-white/5 border-white/20 text-white placeholder:text-white/40 text-[10px]"
          />
          <Select value={filterLevel} onValueChange={setFilterLevel}>
            <SelectTrigger className="w-[120px] h-10 border-white/20 text-white bg-white/5">
              <SelectValue placeholder="Nivel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="TODOS">Todos</SelectItem>
              <SelectItem value="1">L1 Oficial</SelectItem>
              <SelectItem value="2">L2 Supervisor</SelectItem>
              <SelectItem value="3">L3 Gerente</SelectItem>
              <SelectItem value="4">L4 Director</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            <FileSpreadsheet className="w-4 h-4" /> EXCEL
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-10 gap-2">
            <FileDown className="w-4 h-4" /> PDF
          </Button>
          <Dialog open={isOpen} onOpenChange={handleCreateDialogOpenChange}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2 rounded-md" disabled={!canCreateUsers}>
                <Plus className="w-5 h-5 stroke-[3px]" />
                ALTA DE OFICIAL
              </Button>
            </DialogTrigger>
          <DialogContent className="bg-black border-white/10 text-white w-[95vw] md:max-w-lg h-[min(88vh,760px)] overflow-hidden p-0 flex flex-col">
            <div className="border-b border-white/10 px-6 pt-6 pb-4 shrink-0">
            <DialogHeader>
              <DialogTitle className="font-black uppercase italic text-2xl">NUEVO OFICIAL</DialogTitle>
              <DialogDescription className="text-white/60 text-[11px] uppercase font-bold tracking-[0.18em]">
                Alta operativa de personal y credenciales de relevo
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className={`rounded border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${createStep === 1 ? "border-primary bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-white/55"}`}>
                1. Perfil
              </div>
              <div className={`rounded border px-3 py-2 text-[10px] font-black uppercase tracking-widest ${createStep === 2 ? "border-primary bg-primary/15 text-primary" : "border-white/10 bg-white/5 text-white/55"}`}>
                2. Relevo
              </div>
            </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
            <div className="grid gap-4 md:gap-3">
              {createStep === 1 ? (
                <div className="grid gap-4 md:grid-cols-2 md:gap-3">
                  <div className="grid gap-2 md:gap-1.5">
                    <Label className="text-[10px] uppercase font-black text-primary">Nombre Completo</Label>
                    <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="bg-white/5 border-white/10 h-11 md:h-10" placeholder="Nombre y apellidos" />
                  </div>
                  <div className="grid gap-2 md:gap-1.5">
                    <Label className="text-[10px] uppercase font-black text-primary">Correo</Label>
                    <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="bg-white/5 border-white/10 h-11 md:h-10" placeholder="usuario@hoseguridad.com" />
                  </div>
                  <div className="grid gap-2 md:gap-1.5 md:col-span-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Clave Temporal</Label>
                    <Input
                      type="text"
                      value={formData.temporaryPassword}
                      onChange={e => setFormData({...formData, temporaryPassword: e.target.value})}
                      placeholder="Mínimo 8 caracteres"
                      className="bg-white/5 border-white/10 h-11 md:h-10"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 md:gap-3 md:col-span-2">
                    <div className="grid gap-2 md:gap-1.5">
                      <Label className="text-[10px] uppercase font-black text-primary">Nivel</Label>
                      <Select value={formData.role_level} onValueChange={v => setFormData({...formData, role_level: v})}>
                        <SelectTrigger className="bg-white/5 border-white/10 h-11 md:h-10"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="1">Oficial Operativo - L1</SelectItem>
                          <SelectItem value="2">Supervisor - L2</SelectItem>
                          {canManageUsers && <SelectItem value="3">Gerente - L3</SelectItem>}
                          {canAssignL4 && <SelectItem value="4">Director - L4</SelectItem>}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2 md:gap-1.5">
                      <Label className="text-[10px] uppercase font-black text-primary">Estado</Label>
                      <Select value={formData.status} onValueChange={v => setFormData({...formData, status: v})}>
                        <SelectTrigger className="bg-white/5 border-white/10 h-11 md:h-10"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="Activo">Activo</SelectItem><SelectItem value="Inactivo">Inactivo</SelectItem></SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-2 md:gap-1.5 md:col-span-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Perfil de Acceso</Label>
                    <Select onValueChange={v => setFormData({...formData, accessProfile: v})} value={formData.accessProfile} disabled={!canManageUsers}>
                      <SelectTrigger className="bg-white/5 border-white/10 h-11 md:h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEFAULT">Según nivel normal (L1-L4)</SelectItem>
                        {canManageUsers && <SelectItem value="OPS_LIMITED">Operador: incorporar oficiales + revisiones agrupadas + rondas</SelectItem>}
                        {canManageUsers && <SelectItem value="DATA_MANAGER">Encargado de datos: centro de datos + historial + descargas</SelectItem>}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : null}
              {createStep === 2 ? (
                <div className="rounded border border-cyan-400/20 bg-cyan-400/10 p-4 space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-cyan-200">Resumen</p>
                  <div className="grid gap-1 text-[11px] uppercase text-white/80">
                    <p><span className="text-white/45">Nombre:</span> {formData.name || "Sin definir"}</p>
                    <p><span className="text-white/45">Correo:</span> {formData.email || "Sin definir"}</p>
                    <p><span className="text-white/45">Nivel:</span> {draftRoleLabel}</p>
                    {isL1Draft ? (
                      <>
                          <p><span className="text-white/45">Operación base:</span> {selectedOperation || "Sin definir"}</p>
                          <p><span className="text-white/45">Puesto base:</span> {selectedPost || "Sin definir"}</p>
                      </>
                    ) : (
                      <p><span className="text-white/45">Asignado:</span> {formData.assigned || "Sin definir"}</p>
                    )}
                  </div>
                    {isL1Draft ? (
                      <p className="text-[10px] uppercase tracking-wider text-cyan-200/80 leading-5">
                        Esta base inicial mantiene compatibilidad. La autorización real por puesto se administra en Centro Operativo.
                      </p>
                    ) : null}
                </div>
              ) : null}
              {createStep === 2 && isL1Draft ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                      <Label className="text-[10px] uppercase font-black text-primary">Operación base</Label>
                    <Select value={selectedOperation} onValueChange={(value) => { setSelectedOperation(value); setSelectedPost("") }}>
                      <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue placeholder="Seleccionar operación" /></SelectTrigger>
                      <SelectContent>
                        {operationOptions.map((operation) => (
                          <SelectItem key={operation} value={operation}>{operation}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Puesto base</Label>
                    <Select value={selectedPost} onValueChange={setSelectedPost} disabled={!selectedOperation}>
                      <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue placeholder="Seleccionar puesto" /></SelectTrigger>
                      <SelectContent>
                        {postOptions.map((post) => (
                          <SelectItem key={post} value={post}>{post}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <p className="sm:col-span-2 rounded border border-white/10 bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-wider text-white/55 leading-5">
                    Seleccione la base operativa inicial del oficial. Después podrá autorizarlo en uno o varios puestos desde Centro Operativo.
                  </p>
                </div>
              ) : null}
              {createStep === 2 && !isL1Draft ? (
                <div className="grid gap-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Asignado</Label>
                  <Input value={formData.assigned} onChange={e => setFormData({...formData, assigned: e.target.value})} className="bg-white/5 border-white/10 h-11" placeholder="Operación, puesto o alcance" />
                </div>
              ) : null}
              {createStep === 2 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">PIN relevo</Label>
                    <Input
                      value={formData.shiftPin}
                      onChange={e => setFormData({...formData, shiftPin: e.target.value.replace(/\D/g, "")})}
                      placeholder="4 a 8 dígitos"
                      className="bg-white/5 border-white/10 h-11"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Código NFC</Label>
                    <div className="flex gap-2">
                      <Input
                        value={formData.shiftNfcCode}
                        onChange={e => setFormData({...formData, shiftNfcCode: e.target.value})}
                        placeholder="Etiqueta o código NFC"
                        className="bg-white/5 border-white/10 h-11"
                      />
                      <Button type="button" variant="outline" className="border-white/10" onClick={() => void startPersonnelNfcScan("create")} disabled={!nfcSupported || createNfcScanning}>
                        {createNfcScanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <SmartphoneNfc className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
            </div>
            <DialogFooter className="shrink-0 border-t border-white/10 px-6 py-4 bg-black/95 backdrop-blur flex-col sm:flex-row gap-2">
              {createStep === 2 ? (
                <Button type="button" variant="outline" onClick={() => setCreateStep(1)} className="w-full sm:w-auto border-white/20 text-white hover:bg-white/10 font-black uppercase tracking-widest h-12">
                  Volver
                </Button>
              ) : null}
              {createStep === 1 ? (
                <Button type="button" onClick={() => setCreateStep(2)} disabled={!isCreateStepOneValid} className="w-full bg-primary text-black font-black h-12 uppercase tracking-widest">
                  Continuar
                </Button>
              ) : (
                <Button onClick={handleAddPersonnel} className="w-full bg-primary text-black font-black h-12 uppercase tracking-widest">Crear oficial</Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="grid grid-cols-2 lg:grid-cols-1 gap-4 lg:col-span-1">
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-emerald-400 uppercase tracking-widest mb-1">EN LINEA AHORA</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {onlinePersonnel.length}
            </div>
            <div className="text-[9px] text-white/50 mt-2 truncate">
              {onlinePersonnel.slice(0, 3).map((p) => String(p.firstName || "").trim() || "Sin nombre").join(", ") || "Sin usuarios conectados"}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-primary uppercase tracking-widest mb-1">L4 DIRECTIVOS</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 4).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-[#1E3A8A] uppercase tracking-widest mb-1">L3 GERENTES</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 3).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-green-600 uppercase tracking-widest mb-1">L2 SUPERVISORES</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 2).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-white/50 uppercase tracking-widest mb-1">OFICIALES L1</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {personnel?.filter((p) => getRoleLevel(p as unknown as Record<string, unknown>) === 1).length || 0}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-cyan-300 uppercase tracking-widest mb-1">HORAS L1 30D</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {attendanceLoading ? "..." : formatHoursValue(attendanceSummary?.summary.totalWorkedHours ?? 0)}
            </div>
            <div className="text-[9px] text-white/50 mt-2 truncate">
              Promedio por oficial: {formatHoursValue(attendanceSummary?.summary.averageWorkedHours ?? 0)}
            </div>
          </Card>
          <Card className="bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md p-4 md:p-6">
            <div className="text-[9px] font-black text-amber-300 uppercase tracking-widest mb-1">DÍAS LABORADOS 30D</div>
            <div className="text-2xl md:text-3xl font-black text-white tracking-tighter">
              {attendanceLoading ? "..." : attendanceSummary?.summary.totalWorkedDays ?? 0}
            </div>
            <div className="text-[9px] text-white/50 mt-2 truncate">
              Turnos cerrados: {attendanceSummary?.summary.totalCompletedShifts ?? 0} · Abiertos: {attendanceSummary?.summary.totalOpenShifts ?? 0}
            </div>
          </Card>
        </div>

        <Card className="lg:col-span-3 bg-[#0c0c0c]/60 border-white/5 backdrop-blur-md overflow-hidden">
          <CardHeader className="pb-4 px-4 md:px-6">
            <CardTitle className="text-lg md:text-xl font-black text-white uppercase tracking-tight italic">OFICIALES REGISTRADOS</CardTitle>
            {attendanceMessage ? <p className="text-[10px] uppercase font-black text-amber-300">{attendanceMessage}</p> : null}
          </CardHeader>
          <CardContent className="px-0">
            <div className="overflow-x-auto">
              {loading ? (
                <div className="p-20 flex justify-center">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
              ) : (
                <Table>
                  <TableHeader className="bg-white/[0.02]">
                    <TableRow className="hover:bg-transparent border-white/5">
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 md:px-6">USUARIO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 hidden md:table-cell">EMAIL</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">NIVEL</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">ESTADO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">PUESTO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">RH 30D</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4">RELEVO</TableHead>
                      <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-4 px-4 text-right md:px-6"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredPersonnel.length > 0 ? (
                      filteredPersonnel.map((p) => (
                        <TableRow key={p.id} className="border-white/5 hover:bg-white/[0.02] group h-20">
                          {(() => {
                            const attendance = attendanceByOfficer.get(String(p.id ?? ""))
                            return (
                              <>
                          <TableCell className="px-4 md:px-6">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-8 w-8 md:h-10 md:w-10 border border-white/10 bg-black">
                                <AvatarFallback className="text-primary font-black text-[10px] md:text-xs">{String(p.firstName ?? "")[0]}</AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span className="text-[11px] md:text-sm font-black text-white uppercase tracking-tight italic truncate max-w-[80px] md:max-w-none">{String(p.firstName)}</span>
                                <span className="text-[8px] font-bold uppercase tracking-wide text-emerald-400/90 md:text-[9px]">
                                  {formatLastSeen(p as unknown as Record<string, unknown>)}
                                </span>
                                <span className="text-[8px] font-bold text-muted-foreground uppercase md:hidden">{String(p.email)}</span>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="px-4 hidden md:table-cell text-[10px] text-white/70 truncate max-w-[180px]">{String(p.email || "—")}</TableCell>
                          <TableCell className="px-4">
                            <Select value={String(getRoleLevel(p as unknown as Record<string, unknown>))} onValueChange={(v) => handleUpdateRole(p.id, parseInt(v, 10))} disabled={!canManageUsers}>
                              <SelectTrigger className="h-8 w-[95px] border-white/10 bg-white/5 text-[9px] font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="1">L1 Oficial</SelectItem>
                                <SelectItem value="2">L2 Supervisor</SelectItem>
                                {canManageUsers && <SelectItem value="3">L3 Gerente</SelectItem>}
                                {canAssignL4 && <SelectItem value="4">L4 Director</SelectItem>}
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="px-4">
                            <Select value={String(p.status || "Activo")} onValueChange={(v) => handleUpdateStatus(p.id, v)} disabled={!canManageUsers}>
                              <SelectTrigger className="h-8 w-[100px] border-white/10 bg-white/5 text-[9px] font-bold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Activo">Activo</SelectItem>
                                <SelectItem value="Inactivo">Inactivo</SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className="px-4">
                            <div className="space-y-2">
                              <p className="text-[10px] uppercase text-white/65">{String(p.assigned || "Sin asignar")}</p>
                              {getRoleLevel(p as unknown as Record<string, unknown>) === 1 ? (
                                <Button onClick={() => handleOpenAssignmentDialog(p as unknown as Record<string, unknown>)} size="sm" variant="outline" className="h-8 border-white/10 bg-white/5 text-[9px] font-bold uppercase gap-1" disabled={!canManageUsers}>
                                  <Building2 className="w-3 h-3" />
                                  Base
                                </Button>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="px-4">
                            <button type="button" onClick={() => openOfficerProfile(p as unknown as Record<string, unknown>)} className="text-left rounded border border-white/10 bg-white/5 px-3 py-2 min-w-[120px] hover:bg-white/10 disabled:opacity-50" disabled={!attendance}>
                              <p className="text-[10px] font-black uppercase text-white">{attendance ? formatHoursValue(attendance.totalWorkedHours) : "0 h"}</p>
                              <p className="text-[9px] uppercase text-white/55">{attendance ? `${attendance.workedDays} días · ${attendance.completedShifts} turnos` : "Sin datos"}</p>
                            </button>
                          </TableCell>
                          <TableCell className="px-4">
                            <Button onClick={() => handleOpenCredentialDialog(p as unknown as Record<string, unknown>)} size="sm" variant="outline" className="h-8 border-white/10 bg-white/5 text-[9px] font-bold uppercase gap-1" disabled={!canManageUsers}>
                              <KeyRound className="w-3 h-3" />
                              <SmartphoneNfc className="w-3 h-3" />
                            </Button>
                          </TableCell>
                          <TableCell className="text-right px-4 md:px-6">
                            <div className="flex items-center justify-end gap-1">
                              <Button onClick={() => openOfficerProfile(p as unknown as Record<string, unknown>)} size="icon" variant="ghost" className="h-8 w-8 text-cyan-300/70 hover:text-cyan-200" disabled={!attendance}>
                                <IdCard className="h-4 w-4" />
                              </Button>
                              <Button onClick={() => setDeleteId(p.id)} size="icon" variant="ghost" className="h-8 w-8 text-destructive/30 hover:text-destructive" disabled={!canManageUsers}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                              </>
                            )
                          })()}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={8} className="h-64 text-center italic text-muted-foreground/30 font-black uppercase tracking-widest text-[10px]">
                          {personnel?.length ? "Ningún usuario coincide con el filtro." : "Sin registros."}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}