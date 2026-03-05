"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useUser } from "@/supabase"

const routeMinLevel: Array<{ prefix: string; level: number }> = [
  { prefix: "/personnel", level: 4 },
  { prefix: "/operations", level: 3 },
  { prefix: "/weapons", level: 3 },
  { prefix: "/auditoria-gerencial", level: 3 },
  { prefix: "/supervision-agrupada", level: 2 },
  { prefix: "/supervision", level: 2 },
  { prefix: "/incidents", level: 2 },
  { prefix: "/map", level: 1 },
  { prefix: "/rounds", level: 1 },
  { prefix: "/visitors", level: 1 },
  { prefix: "/overview", level: 1 },
]

const getRequiredLevel = (pathname: string) => {
  const match = routeMinLevel.find((item) => pathname.startsWith(item.prefix))
  return match?.level ?? 1
}

export function DashboardAuthWrapper({ children }: { children: React.ReactNode }) {
  const { user, isUserLoading } = useUser()
  const router = useRouter()
  const pathname = usePathname()

  // redirect unauthenticated users back to login
  useEffect(() => {
    if (!isUserLoading && !user) {
      router.replace("/login")
      return
    }

    if (!isUserLoading && user) {
      const minLevel = getRequiredLevel(pathname)
      if ((user.roleLevel ?? 1) < minLevel) {
        router.replace("/overview")
      }
    }
  }, [isUserLoading, user, router, pathname])

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
