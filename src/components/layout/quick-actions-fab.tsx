"use client"

import Link from "next/link"
import { useState } from "react"
import { Route, ShieldAlert, UserPlus, Plus, X } from "lucide-react"

const quickLinks = [
  { href: "/map", label: "Rondas", icon: Route },
  { href: "/incidents/report", label: "Incidentes", icon: ShieldAlert },
  { href: "/visitors", label: "Visitantes", icon: UserPlus },
]

export function QuickActionsFab() {
  const [open, setOpen] = useState(false)

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {open && (
        <div className="flex flex-col gap-2">
          {quickLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-full border border-white/15 bg-[#0b0b0b]/95 px-4 py-2 text-[11px] font-black uppercase tracking-wider text-white shadow-lg backdrop-blur hover:border-primary/60 hover:text-primary transition-colors"
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="h-14 w-14 rounded-full bg-primary text-black shadow-[0_0_30px_rgba(245,158,11,0.35)] flex items-center justify-center hover:scale-105 transition-transform"
        aria-label="Acciones rápidas"
      >
        {open ? <X className="h-6 w-6" /> : <Plus className="h-6 w-6" />}
      </button>
    </div>
  )
}
