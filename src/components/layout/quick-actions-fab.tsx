"use client"

import Link from "next/link"
import { AlertTriangle, Route, ClipboardCheck, Shield } from "lucide-react"
import { usePathname } from "next/navigation"
import { useUser } from "@/supabase"

const primaryQuickLinks = [
  { href: "/station", label: "Puesto activo", icon: Shield, minRoleLevel: 1, maxRoleLevel: 1 },
  { href: "/rounds", label: "Inicio ronda", icon: Route, minRoleLevel: 1 },
  { href: "/incidents/report", label: "Novedad rapida", icon: AlertTriangle, minRoleLevel: 1, maxRoleLevel: 1 },
  { href: "/supervision", label: "Supervision", icon: ClipboardCheck, minRoleLevel: 2 },
]

export function QuickActionsFab() {
  const pathname = usePathname()
  const { user } = useUser()
  const roleLevel = Number(user?.roleLevel ?? 1)
  const hideOnOperationalForms =
    pathname.startsWith("/station") ||
    pathname.startsWith("/rounds") ||
    pathname.startsWith("/supervision") ||
    pathname.startsWith("/incidents/report")

  if (hideOnOperationalForms) return null

  const visibleLinks = primaryQuickLinks.filter((item) => {
    if (roleLevel < item.minRoleLevel) return false
    if (typeof item.maxRoleLevel === "number" && roleLevel > item.maxRoleLevel) return false
    return true
  })

  if (visibleLinks.length === 0) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {visibleLinks.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-2 rounded-full bg-primary text-black px-4 py-2 text-[11px] font-black uppercase tracking-wide shadow-[0_0_30px_rgba(245,158,11,0.35)] hover:scale-105 transition-transform"
        >
          <item.icon className="h-4 w-4" />
          {item.label}
        </Link>
      ))}
        </div>
  )
}
