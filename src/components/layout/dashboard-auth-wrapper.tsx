"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useUser } from "@/supabase"
import { canAccessRouteByPermission, isRestrictedMode } from "@/lib/access-control"
import { getDefaultDashboardRoute } from "@/lib/default-dashboard-route"

const routeMinLevel: Array<{ prefix: string; level: number }> = [
  { prefix: "/data-center", level: 4 },
  { prefix: "/personnel", level: 4 },
  { prefix: "/operations", level: 3 },
  { prefix: "/weapons", level: 3 },
  { prefix: "/auditoria-gerencial", level: 3 },
  { prefix: "/supervision-agrupada", level: 2 },
  { prefix: "/supervision", level: 2 },
  { prefix: "/incidents", level: 1 },
  { prefix: "/map", level: 1 },
  { prefix: "/rounds", level: 1 },
  { prefix: "/station", level: 1 },
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
      const defaultRoute = getDefaultDashboardRoute(user)

      if (isRestrictedMode(user.customPermissions)) {
        if (!canAccessRouteByPermission(pathname, user.customPermissions)) {
          router.replace(defaultRoute)
        }
        return
      }

      const minLevel = getRequiredLevel(pathname)
      if ((user.roleLevel ?? 1) < minLevel) {
        router.replace(defaultRoute)
        return
      }

      if (pathname === "/overview" && defaultRoute !== "/overview") {
        router.replace(defaultRoute)
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
