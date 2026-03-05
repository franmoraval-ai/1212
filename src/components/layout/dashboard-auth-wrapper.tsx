"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useUser } from "@/supabase"

export function DashboardAuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser()
  const router = useRouter()

  // redirect unauthenticated users back to login
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace("/login")
    }
  }, [isUserLoading, user, router])

  if (isUserLoading || !user) {
    return (
      <div className="min-h-screen bg-[#030303] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-[10px] font-black text-primary uppercase tracking-widest">Verificando credenciales...</span>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
