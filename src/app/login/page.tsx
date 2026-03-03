"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Star, Shield } from "lucide-react"
import { useAuth } from "@/firebase"
import { initiateAnonymousSignIn } from "@/firebase"
import { useToast } from "@/hooks/use-toast"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const auth = useAuth()
  const { toast } = useToast()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (email && !email.toLowerCase().endsWith("@hoseguridacr.com")) {
      toast({
        title: "ACCESO DENEGADO",
        description: "Solo correos institucionales @hoseguridacr.com están permitidos.",
        variant: "destructive"
      })
      setLoading(false)
      return
    }

    try {
      initiateAnonymousSignIn(auth)
      toast({
        title: "ACCESO AUTORIZADO",
        description: "Iniciando protocolos de Nivel 4...",
      })
      setTimeout(() => router.push("/overview"), 1500)
    } catch (error) {
      toast({
        title: "FALLO DE AUTENTICACIÓN",
        description: "Credenciales tácticas no reconocidas.",
        variant: "destructive"
      })
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

        <form onSubmit={handleLogin} className="space-y-6 bg-[#111111]/80 backdrop-blur-xl p-10 rounded border border-white/5 shadow-2xl">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">Email Institucional</Label>
            <Input 
              id="email" 
              type="email" 
              placeholder="USUARIO@HOSEGURIDACR.COM" 
              required
              className="bg-black/50 border-white/10 h-14 text-white font-bold uppercase focus:border-[#F59E0B] transition-colors"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="pass" className="text-[10px] font-black uppercase tracking-widest text-[#F59E0B]">Clave de Operación</Label>
            <Input 
              id="pass" 
              type="password" 
              placeholder="••••••••" 
              required
              className="bg-black/50 border-white/10 h-14 text-white font-bold focus:border-[#F59E0B] transition-colors"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button 
            type="submit" 
            disabled={loading}
            className="w-full h-14 bg-[#F59E0B] hover:bg-[#D97706] text-black font-black uppercase tracking-[0.2em] italic shadow-[0_0_30px_rgba(245,158,11,0.2)]"
          >
            {loading ? "VALIDANDO CREDENCIALES..." : "INGRESAR AL SISTEMA"}
          </Button>

          <div className="flex flex-col gap-3 pt-4 text-center">
            <button type="button" className="text-[9px] font-black text-muted-foreground hover:text-white uppercase tracking-widest transition-colors">
              ¿OLVIDÓ SU CLAVE TÁCTICA?
            </button>
            <button type="button" className="text-[9px] font-black text-[#F59E0B] hover:underline uppercase tracking-widest transition-colors">
              SOLICITAR ALTA DE PERFIL
            </button>
          </div>
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