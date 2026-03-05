"use client"

import { useState } from "react"
import { Bell, Settings, LogOut, AlertTriangle, ExternalLink } from "lucide-react"
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

export function HeaderActions() {
  const router = useRouter()
  const { supabase, user } = useSupabase()
  const { toast } = useToast()
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const { data: alerts } = useCollection(user ? "alerts" : null, { orderBy: "created_at", orderDesc: true })
  const recentAlerts = (alerts ?? []).slice(0, 10)

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
            {recentAlerts.length > 0 && (
              <span className="absolute top-1 right-1 md:top-2 md:right-2 min-w-[8px] h-2 px-1 flex items-center justify-center bg-primary rounded-full border-2 border-[#030303] text-[9px] font-bold text-black">
                {recentAlerts.length > 9 ? "9+" : recentAlerts.length}
              </span>
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72 md:w-80 bg-[#0c0c0c] border-white/10 text-white">
          <DropdownMenuLabel className="text-xs font-black uppercase tracking-wider text-white/80">
            Notificaciones
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-white/10" />
          {recentAlerts.length === 0 ? (
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
