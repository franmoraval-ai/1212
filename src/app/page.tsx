"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { getDefaultDashboardRoute } from "@/lib/default-dashboard-route"
import { useUser } from "@/supabase"

export default function RootPage() {
  const router = useRouter()
  const { user, isUserLoading } = useUser()

  useEffect(() => {
    if (isUserLoading) return
    router.replace(getDefaultDashboardRoute(user))
  }, [isUserLoading, router, user])

  return (
    <div className="min-h-screen bg-[#030303] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black text-primary uppercase tracking-widest">Cargando acceso operativo...</span>
      </div>
    </div>
  )
}