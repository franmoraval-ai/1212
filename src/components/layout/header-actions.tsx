"use client"

import { useEffect, useMemo, useState } from "react"
import { Bell, Settings, LogOut, AlertTriangle, ExternalLink, Download } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { mapPasswordProviderError, validateStrongPassword } from "@/lib/password-policy"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

const INTERNAL_NOTES_SLA_HOURS = Math.max(1, Number(process.env.NEXT_PUBLIC_INTERNAL_NOTES_SLA_HOURS ?? 24))

function getRoundFraudMessages(logs: unknown): string[] {
  if (!logs || typeof logs !== "object") return []
  const candidate = (logs as { alerts?: unknown }).alerts
  if (!candidate || typeof candidate !== "object") return []
  const messages = (candidate as { messages?: unknown }).messages
  return Array.isArray(messages) ? messages.map((m) => String(m)).filter(Boolean) : []
}

function toDate(value: unknown) {
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

function isInternalNoteOverdue(createdAtValue: unknown, statusValue: unknown) {
  const status = String(statusValue ?? "abierta")
  if (status === "resuelta") return false
  const createdAt = toDate(createdAtValue)
  if (!createdAt) return false
  const elapsedMs = Date.now() - createdAt.getTime()
  return elapsedMs >= INTERNAL_NOTES_SLA_HOURS * 60 * 60 * 1000
}

export function HeaderActions() {
  const router = useRouter()
  const { supabase, user } = useSupabase()
  const { toast } = useToast()
  const { user: appUser } = useUser()
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [canInstall, setCanInstall] = useState(false)
  const [installFallback, setInstallFallback] = useState<"ios" | "unsupported" | null>(null)
  const { data: alerts } = useCollection(user ? "alerts" : null, {
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 60000,
  })
  const { data: internalNotes } = useCollection(user ? "internal_notes" : null, {
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 60000,
  })
  const { data: roundReports } = useCollection<{
    id?: string
    roundName?: string
    officerName?: string
    createdAt?: { toDate?: () => Date }
    checkpointLogs?: unknown
    checkpoint_logs?: unknown
  }>((user && (appUser?.roleLevel ?? 1) >= 2) ? "round_reports" : null, {
    orderBy: "created_at",
    orderDesc: true,
    realtime: false,
    pollingMs: 45000,
  })
  const recentAlerts = (alerts ?? []).slice(0, 10)
  const recentFraudAlerts = ((roundReports ?? [])
    .map((r) => {
      const logs = r.checkpointLogs ?? r.checkpoint_logs
      const messages = getRoundFraudMessages(logs)
      if (messages.length === 0) return null
      return {
        id: String(r.id ?? ""),
        roundName: String(r.roundName ?? "Ronda"),
        officerName: String(r.officerName ?? "Oficial"),
        at: r.createdAt?.toDate?.() ?? null,
        messages,
      }
    })
    .filter((v): v is { id: string; roundName: string; officerName: string; at: Date | null; messages: string[] } => v !== null)
    .slice(0, 8))
  const scopedInternalNotes = useMemo(() => {
    const source = internalNotes ?? []
    if ((appUser?.roleLevel ?? 1) !== 1) return source

    const currentUid = String(appUser?.uid ?? "").trim()
    const currentEmail = String(appUser?.email ?? "").trim().toLowerCase()

    return source.filter((note) => {
      const noteUid = String(note.reportedByUserId ?? "").trim()
      const noteEmail = String(note.reportedByEmail ?? "").trim().toLowerCase()
      if (currentUid && noteUid === currentUid) return true
      if (currentEmail && noteEmail === currentEmail) return true
      return false
    })
  }, [appUser?.email, appUser?.roleLevel, appUser?.uid, internalNotes])

  const unresolvedInternalNotes = scopedInternalNotes
    .filter((note) => String(note.status ?? "abierta") !== "resuelta")
    .map((note) => ({
      ...note,
      overdue: isInternalNoteOverdue(note.createdAt, note.status),
    }))
  const overdueInternalNotesCount = unresolvedInternalNotes.filter((note) => note.overdue).length
  const recentUnresolvedInternalNotes = unresolvedInternalNotes.slice(0, 8)
  const totalNotificationCount = recentAlerts.length + recentFraudAlerts.length + unresolvedInternalNotes.length

  useEffect(() => {
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    if (isStandalone) {
      setCanInstall(false)
      return
    }

    const ua = window.navigator.userAgent.toLowerCase()
    const isIOS = /iphone|ipad|ipod/.test(ua)
    const isSafari = /safari/.test(ua) && !/crios|fxios|edgios|opr\//.test(ua)
    if (isIOS && isSafari) {
      setInstallFallback("ios")
      setCanInstall(true)
    } else {
      setInstallFallback("unsupported")
      setCanInstall(true)
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      setInstallFallback(null)
      setCanInstall(true)
    }

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt)
  }, [])

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut()
      router.push("/login")
    } catch {
      router.push("/login")
    }
  }

  const handleChangePassword = async () => {
    const validation = validateStrongPassword(newPassword)
    if (!validation.ok) {
      toast({ title: "Clave invalida", description: validation.message, variant: "destructive" })
      return
    }

    if (newPassword !== confirmPassword) {
      toast({ title: "No coincide", description: "La confirmacion de clave no coincide.", variant: "destructive" })
      return
    }

    setIsUpdatingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error

      toast({ title: "Clave actualizada", description: "Su clave fue cambiada correctamente." })
      setPasswordDialogOpen(false)
      setNewPassword("")
      setConfirmPassword("")
    } catch (err: any) {
      toast({ title: "Error", description: mapPasswordProviderError(err?.message), variant: "destructive" })
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  const handleInstallApp = async () => {
    if (!installPrompt) {
      if (installFallback === "ios") {
        toast({
          title: "Instalacion manual en iPhone/iPad",
          description: "Abra en Safari, toque Compartir y elija 'Agregar a pantalla de inicio'."
        })
        return
      }

      toast({
        title: "Instalacion manual",
        description: "Abra en Chrome o Edge y use el menu del navegador para 'Instalar app'."
      })
      return
    }

    await installPrompt.prompt()
    const choice = await installPrompt.userChoice
    if (choice.outcome === "accepted") {
      toast({ title: "Instalacion iniciada", description: "La app se agregara a su dispositivo." })
      setCanInstall(false)
      setInstallPrompt(null)
      return
    }

    toast({ title: "Instalacion cancelada", description: "Puede intentarlo nuevamente desde Configuracion." })
  }

  return (
    <div className="flex items-center gap-2 md:gap-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="relative group p-1.5 md:p-2 hover:bg-white/5 rounded-full transition-colors"
            aria-label="Notificaciones"
          >
            <Bell className="w-4 h-4 md:w-5 md:h-5 text-muted-foreground group-hover:text-primary transition-all" />
            {totalNotificationCount > 0 && (
              <span className="absolute top-1 right-1 md:top-2 md:right-2 min-w-[8px] h-2 px-1 flex items-center justify-center bg-primary rounded-full border-2 border-[#030303] text-[9px] font-bold text-black">
                {totalNotificationCount > 9 ? "9+" : totalNotificationCount}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 md:w-80 bg-[#0c0c0c] border-white/10 text-white">
          <DropdownMenuLabel className="text-xs font-black uppercase tracking-wider text-white/80">
            Notificaciones
          </DropdownMenuLabel>
          {overdueInternalNotesCount > 0 ? (
            <div className="px-2 pb-1 text-[10px] font-black uppercase tracking-wider text-red-300">
              {overdueInternalNotesCount} vencida(s) en novedades internas ({INTERNAL_NOTES_SLA_HOURS}h)
            </div>
          ) : null}
          <DropdownMenuSeparator className="bg-white/10" />
          {recentAlerts.length === 0 && recentFraudAlerts.length === 0 && recentUnresolvedInternalNotes.length === 0 ? (
            <div className="py-6 px-3 text-center text-[11px] text-muted-foreground uppercase tracking-wider">
              Sin notificaciones recientes
            </div>
          ) : (
            <div className="max-h-[280px] overflow-y-auto">
              {recentAlerts.map((a: { id?: string; type?: string; userEmail?: string; createdAt?: { toDate?: () => Date } }) => (
                <DropdownMenuItem
                  key={a.id}
                  className="flex flex-col items-start gap-0.5 py-3 px-3 cursor-default focus:bg-white/10 focus:text-white"
                >
                  <div className="flex items-center gap-2 w-full">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-[10px] font-black uppercase text-red-400">Alerta</span>
                    <span className="text-[10px] text-white/50 truncate ml-auto">
                      {a.createdAt?.toDate?.()?.toLocaleString?.() ?? "—"}
                    </span>
                  </div>
                  <span className="text-[11px] text-white/70 truncate w-full">{a.userEmail ?? "Sin usuario"}</span>
                </DropdownMenuItem>
              ))}
              {(appUser?.roleLevel ?? 1) >= 2 && recentFraudAlerts.map((a) => (
                <DropdownMenuItem
                  key={`fraud-${a.id}`}
                  className="flex flex-col items-start gap-0.5 py-3 px-3 cursor-default focus:bg-white/10 focus:text-white"
                >
                  <div className="flex items-center gap-2 w-full">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span className="text-[10px] font-black uppercase text-amber-300">Fraude ronda</span>
                    <span className="text-[10px] text-white/50 truncate ml-auto">
                      {a.at?.toLocaleString?.() ?? "—"}
                    </span>
                  </div>
                  <span className="text-[11px] text-white/80 truncate w-full">{a.roundName} / {a.officerName}</span>
                  <span className="text-[10px] text-amber-100 truncate w-full">{a.messages[0]}</span>
                </DropdownMenuItem>
              ))}
              {recentUnresolvedInternalNotes.map((note: { id?: string; postName?: string; priority?: string; createdAt?: { toDate?: () => Date }; overdue?: boolean }) => (
                <DropdownMenuItem
                  key={`internal-${note.id}`}
                  className="flex flex-col items-start gap-0.5 py-3 px-3 cursor-default focus:bg-white/10 focus:text-white"
                >
                  <div className="flex items-center gap-2 w-full">
                    <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${note.overdue ? "text-red-300" : "text-blue-300"}`} />
                    <span className={`text-[10px] font-black uppercase ${note.overdue ? "text-red-300" : "text-blue-300"}`}>
                      {note.overdue ? "Novedad vencida" : "Novedad interna"}
                    </span>
                    <span className="text-[10px] text-white/50 truncate ml-auto">
                      {note.createdAt?.toDate?.()?.toLocaleString?.() ?? "—"}
                    </span>
                  </div>
                  <span className="text-[11px] text-white/80 truncate w-full">{note.postName ?? "Puesto"}</span>
                  <span className={`text-[10px] truncate w-full ${note.overdue ? "text-red-200" : "text-blue-100"}`}>
                    Prioridad: {note.priority ?? "media"}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          )}
          <DropdownMenuSeparator className="bg-white/10" />
          <DropdownMenuItem asChild>
            <Link
              href="/overview"
              className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold uppercase">Ver en dashboard</span>
            </Link>
          </DropdownMenuItem>
          {(appUser?.roleLevel ?? 1) >= 2 && (
            <DropdownMenuItem asChild>
              <Link
                href="/rounds"
                className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="text-[11px] font-bold uppercase">Ver alertas de rondas</span>
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link
              href="/internal-notes"
              className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="text-[11px] font-bold uppercase">Ver novedades internas</span>
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="h-6 w-px bg-white/10 hidden md:block" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 md:gap-3 group cursor-pointer rounded-full focus:outline-none focus:ring-2 focus:ring-primary/50"
            aria-label="Configuración"
          >
            <div className="h-8 w-8 md:h-10 md:w-10 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:border-primary/50 transition-all overflow-hidden">
              <Settings className="w-3.5 h-3.5 md:w-4 md:h-4 text-muted-foreground group-hover:text-primary group-hover:rotate-90 transition-all duration-500" />
            </div>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-[#0c0c0c] border-white/10 text-white">
          <DropdownMenuLabel className="text-xs font-black uppercase tracking-wider text-white/80">
            Cuenta
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-white/10" />
          {canInstall && (
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault()
                void handleInstallApp()
              }}
              className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white text-[11px] font-bold uppercase"
            >
              <Download className="w-4 h-4" />
              Instalar app
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={(event) => {
              event.preventDefault()
              setPasswordDialogOpen(true)
            }}
            className="flex items-center gap-2 cursor-pointer focus:bg-white/10 focus:text-white text-[11px] font-bold uppercase"
          >
            <Settings className="w-4 h-4" />
            Cambiar clave
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={handleSignOut}
            className="flex items-center gap-2 cursor-pointer focus:bg-red-500/20 focus:text-red-400 text-[11px] font-bold uppercase"
          >
            <LogOut className="w-4 h-4" />
            Cerrar sesión
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Cambiar clave</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Defina su nueva clave de acceso.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5">
              <Label htmlFor="new-password" className="text-[10px] uppercase font-black text-primary">Nueva clave</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-black/40 border-white/10"
                placeholder="Minimo 8 caracteres"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-password" className="text-[10px] uppercase font-black text-primary">Confirmar clave</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-black/40 border-white/10"
                placeholder="Repita la nueva clave"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              onClick={handleChangePassword}
              disabled={isUpdatingPassword}
              className="w-full bg-primary text-black font-black uppercase"
            >
              {isUpdatingPassword ? "Actualizando..." : "Actualizar clave"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
