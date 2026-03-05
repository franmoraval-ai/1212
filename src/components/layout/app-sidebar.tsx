
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
  UserPlus
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"
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
  { icon: LayoutDashboard, label: "Dashboard Global", href: "/overview" },
  { icon: ListChecks, label: "Supervisión Agrupada", href: "/supervision-agrupada" },
  { icon: Users, label: "Gestión Personal", href: "/personnel" },
  { icon: Zap, label: "Control de Armas", href: "/weapons" },
  { icon: Route, label: "Maestro de Rondas", href: "/map" },
  { icon: ShieldAlert, label: "Auditoría Incidentes", href: "/incidents" },
  { icon: ClipboardCheck, label: "Supervisión Campo", href: "/supervision" },
  { icon: Briefcase, label: "Auditoría Gerencial", href: "/auditoria-gerencial" },
  { icon: UserPlus, label: "Registro Visitantes", href: "/visitors" },
]

export function AppSidebar() {
  const pathname = usePathname()

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
                NIVEL 4
              </span>
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarSeparator className="opacity-5 mx-6" />
      <SidebarContent className="px-3 pt-6">
        <SidebarMenu>
          {navItems.map((item) => {
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
            <SidebarMenuButton className="text-muted-foreground/40 hover:text-white transition-colors group h-10">
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
