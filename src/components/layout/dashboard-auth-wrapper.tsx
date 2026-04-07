"use client"

import { useEffect, useState } from "react"
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
  const [hadUser, setHadUser] = useState(false)

  // Track first successful user load — only transitions false→true.
  // Calling setState during render is the React-sanctioned pattern for
  // derived state from props (replaces the former ref read during render).
  if (user && !hadUser) {
    setHadUser(true)
  }

  // redirect unauthenticated users back to login (only when online)
  useEffect(() => {
    if (!isUserLoading && !user) {
      // If offline, don't redirect — the user may just have no network.
      // The cached user in SupabaseProvider should keep them logged in.
      // Only redirect to login when we're confident the session is truly gone.
      if (typeof navigator !== "undefined" && !navigator.onLine) return
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
    }
  }, [isUserLoading, user, router, pathname])

  // Only show the full-screen spinner during initial bootstrap.
  // Once a user has been confirmed, keep children mounted during
  // any background re-validation (camera return, token refresh, etc.)
  // so that in-progress form data and photos are never destroyed.
  if ((isUserLoading || !user) && !hadUser) {
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
