
"use client"

import {
  LayoutDashboard,
  Route,
  ShieldAlert,
  ClipboardCheck,
  Briefcase,
  LogOut,
  Users,
  ListChecks,
  Shield,
  Zap,
  UserPlus,
  Building2
} from "lucide-react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useSupabase, useUser } from "@/supabase"
import { moduleFlags } from "@/lib/module-flags"
import { hasPermission, isRestrictedMode, type CustomPermission } from "@/lib/access-control"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar"

const navItems = [
  { icon: LayoutDashboard, label: "Panel del Dia", href: "/overview", minLevel: 1, enabled: moduleFlags.overview },
  { icon: UserPlus, label: "Bitacora de Visitas", href: "/visitors", minLevel: 1, enabled: moduleFlags.visitors },
  { icon: Route, label: "Rutas de Ronda", href: "/map", minLevel: 1, enabled: moduleFlags.map },
  { icon: ListChecks, label: "Boleta de Ronda", href: "/rounds", minLevel: 1, enabled: moduleFlags.rounds, requiredPermission: "rounds_access" as CustomPermission },
  { icon: ClipboardCheck, label: "Revision en Sitio", href: "/supervision", minLevel: 2, enabled: moduleFlags.supervision },
  { icon: ListChecks, label: "Resumen de Revisiones", href: "/supervision-agrupada", minLevel: 2, enabled: moduleFlags.supervisionGrouped, requiredPermission: "supervision_grouped_view" as CustomPermission },
  { icon: ShieldAlert, label: "Reporte de Incidentes", href: "/incidents", minLevel: 1, enabled: moduleFlags.incidents },
  { icon: Building2, label: "Operaciones", href: "/operations", minLevel: 3, enabled: moduleFlags.operations },
  { icon: Zap, label: "Armas y Equipo", href: "/weapons", minLevel: 3, enabled: moduleFlags.weapons },
  { icon: Briefcase, label: "Auditoria de Cuenta", href: "/auditoria-gerencial", minLevel: 3, enabled: moduleFlags.managementAudit },
  { icon: Users, label: "Equipo de Guardas", href: "/personnel", minLevel: 4, enabled: moduleFlags.personnel, requiredPermission: "personnel_view" as CustomPermission },
]

export function AppSidebar() {
  const router = useRouter()
  const pathname = usePathname()
  const { supabase } = useSupabase()
  const { user } = useUser()
  const currentLevel = user?.roleLevel ?? 1
  const restricted = isRestrictedMode(user?.customPermissions)
  const allowedNavItems = navItems.filter((item) => {
    if (!item.enabled) return false
    if (!restricted) return currentLevel >= item.minLevel
    if (!item.requiredPermission) return false
    return hasPermission(user?.customPermissions, item.requiredPermission)
  })

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut()
      router.push("/login")
    } catch {
      router.push("/login")
    }
  }

  return (
    <Sidebar variant="sidebar" collapsible="icon" className="border-r border-white/5 bg-[#0a0a0a]">
      <SidebarHeader className="py-8 px-6">
        <div className="flex items-center gap-4">
          <div className="bg-primary p-2 rounded shrink-0">
            <Shield className="w-6 h-6 text-black" />
          </div>
          <div className="flex flex-col group-data-[collapsible=icon]:hidden overflow-hidden">
            <span className="font-bold text-base tracking-tight text-white uppercase truncate">
              HO SEGURIDAD
            </span>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[8px] font-bold text-blue-400 uppercase tracking-widest">
                NIVEL {currentLevel}
              </span>
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator className="opacity-5 mx-6" />
      <SidebarContent className="px-3 pt-6">
        <SidebarMenu>
          {allowedNavItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  asChild
                  isActive={isActive}
                  tooltip={item.label}
                  className={`h-11 transition-all duration-200 mb-1 rounded-md ${
                    isActive 
                      ? "bg-white/5 text-primary" 
                      : "text-muted-foreground hover:text-white hover:bg-white/[0.03]"
                  }`}
                >
                  <Link href={item.href} className="flex items-center gap-3">
                    <item.icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-muted-foreground/60"}`} />
                    <span className="font-semibold text-xs group-data-[collapsible=icon]:hidden">
                      {item.label}
                    </span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )
          })}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter className="p-6">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleSignOut}
              className="text-muted-foreground/40 hover:text-white transition-colors group h-10"
            >
              <LogOut className="w-4 h-4" />
              <span className="font-bold uppercase text-[9px] tracking-widest group-data-[collapsible=icon]:hidden">
                Cerrar Sesión
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
