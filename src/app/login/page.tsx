"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Star, Shield } from "lucide-react"
import { useSupabase } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { mapPasswordProviderError, validateStrongPassword } from "@/lib/password-policy"

const ALLOWED_EMAIL_DOMAINS = ["gmail.com", "hoseguridacr.com", "hoseguridad.com"]

const isAllowedDomain = (email: string) => {
  const domain = email.toLowerCase().split("@")[1] ?? ""
  return ALLOWED_EMAIL_DOMAINS.includes(domain)
}

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "signup">("login")
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const { supabase, user, isUserLoading } = useSupabase()
  const { toast } = useToast()

  // En recuperación de clave no redirigir al dashboard automáticamente.
  useEffect(() => {
    if (!isUserLoading && user && !isRecoveryMode) {
      router.replace("/overview")
    }
  }, [isUserLoading, user, router, isRecoveryMode])

  useEffect(() => {
    if (typeof window === "undefined") return

    const hash = window.location.hash.startsWith("#")
      ? window.location.hash.slice(1)
      : window.location.hash
    const hashParams = new URLSearchParams(hash)
    const type = hashParams.get("type")

    if (type === "recovery") {
      setIsRecoveryMode(true)
      setMode("login")
      toast({ title: "Recuperación activa", description: "Defina su nueva clave para continuar." })
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecoveryMode(true)
      }
    })

    return () => subscription.unsubscribe()
  }, [supabase.auth, toast])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (email && !isAllowedDomain(email)) {
      toast({
        title: "ACCESO DENEGADO",
        description: "Dominios permitidos: gmail.com, hoseguridacr.com, hoseguridad.com.",
        variant: "destructive"
      })
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error

      toast({
        title: "ACCESO AUTORIZADO",
        description: "Redirigiendo al panel...",
      })
      router.push("/overview")
    } catch (err: any) {
      toast({
        title: "FALLO DE AUTENTICACIÓN",
        description: err.message || "Credenciales inválidas.",
        variant: "destructive"
      })
      setLoading(false)
    }
  }

  const handleRecoveryUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const validation = validateStrongPassword(password)
    if (!validation.ok) {
      toast({ title: "CLAVE NO VALIDA", description: validation.message, variant: "destructive" })
      setLoading(false)
      return
    }

    if (password !== confirmPassword) {
      toast({ title: "NO COINCIDE", description: "La confirmación de clave no coincide.", variant: "destructive" })
      setLoading(false)
      return
    }

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error

      toast({ title: "CLAVE ACTUALIZADA", description: "Ya puede ingresar al sistema con su nueva clave." })
      setIsRecoveryMode(false)
      setConfirmPassword("")
      router.push("/overview")
    } catch (err: any) {
      toast({ title: "ERROR", description: mapPasswordProviderError(err?.message), variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (!fullName.trim()) {
      toast({ title: "Nombre requerido", description: "Ingrese su nombre completo.", variant: "destructive" })
      setLoading(false)
      return
    }

    if (email && !isAllowedDomain(email)) {
      toast({
        title: "ACCESO DENEGADO",
        description: "Dominios permitidos: gmail.com, hoseguridacr.com, hoseguridad.com.",
        variant: "destructive"
      })
      setLoading(false)
      return
    }

    try {
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error

      // Crear/actualizar registro operativo en tabla users con nivel base L1.
      const userEmail = data.user?.email ?? email
      const { error: profileError } = await supabase.from("users").upsert(
        {
          email: userEmail,
          first_name: fullName.trim(),
          role_level: 1,
          status: "Activo",
          assigned: "",
          created_at: new Date().toISOString(),
        },
        { onConflict: "email" }
      )
      if (profileError) throw profileError

      toast({
        title: "USUARIO CREADO",
        description: "Su perfil fue registrado. Ya puede iniciar sesión.",
      })

      setMode("login")
      setPassword("")
    } catch (err: any) {
      toast({
        title: "FALLO EN ALTA",
        description: mapPasswordProviderError(err?.message),
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    if (!email) {
      toast({ title: "Correo requerido", description: "Ingrese su correo para recuperar la clave.", variant: "destructive" })
      return
    }

    if (!isAllowedDomain(email)) {
      toast({
        title: "ACCESO DENEGADO",
        description: "Dominios permitidos: gmail.com, hoseguridacr.com, hoseguridad.com.",
        variant: "destructive"
      })
      return
    }

    setLoading(true)
    try {
      const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/login` : undefined
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
      if (error) throw error
      toast({ title: "Correo enviado", description: "Revise su correo para cambiar la clave." })
    } catch (err: any) {
      toast({ title: "Error", description: err.message || "No se pudo enviar el correo de recuperacion.", variant: "destructive" })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] flex flex-col items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(circle_at_50%_40%,rgba(245,158,11,0.05)_0%,transparent_70%)]" />
      
      <div className="w-full max-w-md z-10 space-y-12">
        <div className="flex flex-col items-center space-y-6">
          <div className="bg-[#F59E0B] p-5 rounded shadow-[0_0_40px_rgba(245,158,11,0.3)]">
            <Star className="w-12 h-12 text-black fill-black" />
          </div>
          <div className="text-center space-y-1">
            <h1 className="text-4xl font-black text-white italic tracking-tighter uppercase">
              HO SEGURIDAD
            </h1>
            <div className="flex items-center justify-center gap-2">
              <span className="badge-nivel-4">NIVEL 4</span>
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.4em]">MANDO CENTRAL</span>
            </div>
          </div>
        </div>

        <form onSubmit={isRecoveryMode ? handleRecoveryUpdate : mode === "login" ? handleLogin : handleSignUp} className="space-y-6 bg-[#111111]/80 backdrop-blur-xl p-10 rounded border border-white/5 shadow-2xl">
          {isRecoveryMode && (
            <div className="rounded border border-primary/30 bg-primary/10 p-3 text-center">
              <span className="text-[10px] font-black uppercase tracking-wider text-primary">Modo recuperación de clave</span>
            </div>
          )}

          {mode === "signup" && (
            <div className="space-y-2">
              <Label htmlFor="fullName" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">Nombre Completo</Label>
              <Input
                id="fullName"
                type="text"
                placeholder="NOMBRE Y APELLIDO"
                required
                className="bg-black/50 border-white/10 h-14 text-white font-bold uppercase focus:border-[#F59E0B] transition-colors"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          )}

          {!isRecoveryMode && (
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">Correo</Label>
            <Input 
              id="email" 
              type="email" 
              placeholder="USUARIO@GMAIL.COM" 
              required
              className="bg-black/50 border-white/10 h-14 text-white font-bold uppercase focus:border-[#F59E0B] transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          )}
          
          <div className="space-y-2">
            <Label htmlFor="pass" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">{isRecoveryMode ? "Nueva Clave" : "Clave de Operación"}</Label>
            <Input 
              id="pass" 
              type="password" 
              placeholder={isRecoveryMode ? "Minimo 8 caracteres" : "••••••••"} 
              required
              className="bg-black/50 border-white/10 h-14 text-white font-bold focus:border-[#F59E0B] transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {isRecoveryMode && (
            <div className="space-y-2">
              <Label htmlFor="confirmPass" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">Confirmar Clave</Label>
              <Input
                id="confirmPass"
                type="password"
                placeholder="Repita la nueva clave"
                required
                className="bg-black/50 border-white/10 h-14 text-white font-bold focus:border-[#F59E0B] transition-colors"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          )}

          <Button 
            type="submit" 
            disabled={loading}
            className="w-full h-14 bg-[#F59E0B] hover:bg-[#D97706] text-black font-black uppercase tracking-[0.2em] italic shadow-[0_0_30px_rgba(245,158,11,0.2)]"
          >
            {loading ? "PROCESANDO..." : isRecoveryMode ? "ACTUALIZAR CLAVE" : mode === "login" ? "INGRESAR AL SISTEMA" : "CREAR USUARIO"}
          </Button>

          {!isRecoveryMode && (
          <div className="flex flex-col gap-3 pt-4 text-center">
            <button
              type="button"
              onClick={handleForgotPassword}
              disabled={loading}
              className="text-[9px] font-black text-muted-foreground hover:text-white uppercase tracking-widest transition-colors disabled:opacity-50"
            >
              ¿OLVIDÓ SU CLAVE TÁCTICA?
            </button>
            <button
              type="button"
              onClick={() => setMode((prev) => (prev === "login" ? "signup" : "login"))}
              className="text-[9px] font-black text-[#F59E0B] hover:underline uppercase tracking-widest transition-colors"
            >
              {mode === "login" ? "SOLICITAR ALTA DE PERFIL" : "VOLVER A INICIAR SESIÓN"}
            </button>
          </div>
          )}
        </form>

        <div className="flex items-center justify-center gap-6 opacity-30">
          <Shield className="w-5 h-5 text-white" />
          <div className="w-px h-4 bg-white/20" />
          <span className="text-[8px] font-black text-white uppercase tracking-[0.4em]">PROTOCOLO DE SEGURIDAD ACTIVO</span>
        </div>
      </div>
    </div>
  )
}