"use client"

import Link from "next/link"
import { Route, ClipboardCheck } from "lucide-react"
import { usePathname } from "next/navigation"

const primaryQuickLinks = [
  { href: "/supervision", label: "Supervision", icon: ClipboardCheck },
  { href: "/rounds", label: "Inicio ronda", icon: Route },
]

export function QuickActionsFab() {
  const pathname = usePathname()
  const hideOnOperationalForms =
    pathname.startsWith("/rounds") ||
    pathname.startsWith("/supervision") ||
    pathname.startsWith("/incidents/report")

  if (hideOnOperationalForms) return null

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-2">
      {primaryQuickLinks.map((item) => (
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
