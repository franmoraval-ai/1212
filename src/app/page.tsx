import { redirect } from "next/navigation"

export default function RootPage() {
  // Redireccionamos a la vista general para evitar colisiones con el grupo de rutas.
  redirect("/overview")
}