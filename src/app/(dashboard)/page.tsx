"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

/**
 * Página raíz del route group (dashboard).
 * Cliente component que redirige a /overview.
 * 
 * IMPORTANTE: Este debe ser un componente interactivo "use client" para que
 * Next.js genere page_client-reference-manifest.js en (dashboard),
 * que es crítico para que Vercel pueda empaquetar correctamente la aplicación.
 */
export default function DashboardPage() {
  const router = useRouter()
  const [isRedirecting, setIsRedirecting] = useState(false)

  useEffect(() => {
    // Pequeño delay para asegurar que el componente está montado
    setIsRedirecting(true)
    const timer = setTimeout(() => {
      router.replace("/overview")
    }, 0)

    return () => clearTimeout(timer)
  }, [router])

  // Renderiza null para que el componente cliente exista pero sea invisible
  return null
}