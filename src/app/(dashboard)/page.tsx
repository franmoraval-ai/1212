import { redirect } from "next/navigation"

/**
 * Este archivo se deja como redundancia de seguridad para redirigir 
 * cualquier acceso accidental a la raíz del grupo a la vista general.
 */
export default function DashboardRedirect() {
  redirect("/overview")
}