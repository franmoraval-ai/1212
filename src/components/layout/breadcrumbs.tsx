"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"

const routeLabels: Record<string, string> = {
  overview: "Panel del Dia",
  "supervision-agrupada": "Resumen de Revisiones",
  personnel: "Equipo de Guardas",
  operations: "Centro Operativo",
  weapons: "Armas y Equipo",
  rounds: "Boleta de Ronda",
  incidents: "Reporte de Incidentes",
  "shift-book": "Libro de Turno",
  supervision: "Revision en Sitio",
  visitors: "Bitacora de Visitas",
  map: "Puntos de Reaccion",
  "auditoria-gerencial": "Auditoria de Cuenta",
}

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)
  if (segments.length === 0 || (segments.length === 1 && segments[0] === "overview")) return null

  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground">
      <Link href="/overview" className="hover:text-primary transition-colors font-medium">
        Inicio
      </Link>
      {segments.map((segment, i) => {
        const href = "/" + segments.slice(0, i + 1).join("/")
        const label = routeLabels[segment] ?? segment
        const isLast = i === segments.length - 1
        return (
          <span key={`${segment}-${i}`} className="flex items-center gap-1">
            <ChevronRight className="w-3 h-3 text-white/30" />
            {isLast ? (
              <span className="font-bold text-white/80 uppercase tracking-wider">{label}</span>
            ) : (
              <Link href={href} className="hover:text-primary transition-colors font-medium uppercase tracking-wider">
                {label}
              </Link>
            )}
          </span>
        )
      })}
    </nav>
  )
}
