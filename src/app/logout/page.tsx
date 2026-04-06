"use client"

import { useEffect } from "react"
import { useSupabase } from "@/supabase"
import { performClientSignOut } from "@/lib/client-signout"

export default function LogoutPage() {
  const { supabase } = useSupabase()

  useEffect(() => {
    void performClientSignOut(supabase)
  }, [supabase])

  return (
    <div className="min-h-screen bg-[#030303] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-[10px] font-black text-primary uppercase tracking-widest">Cerrando sesion...</span>
      </div>
    </div>
  )
}