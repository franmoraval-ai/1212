"use client"

import { useCallback, useEffect, useState } from "react"
import { fetchInternalApi } from "@/lib/internal-api"
import { useSupabase, useUser } from "@/supabase"
import { useSharedRefreshLoop } from "./use-shared-poll"

export type SupervisionFindingRow = {
  id: string
  supervision_id: string
  checklist_key: string
  category: string
  description: string
  severity: "BAJA" | "MEDIA" | "ALTA" | "CRITICA"
  corrected_onsite: boolean
  follow_up_required: boolean
  responsible_user_id?: string | null
  corrective_action?: string | null
  due_at?: string | null
  status: "ABIERTO" | "EN_EJECUCION" | "PENDIENTE_VERIFICACION" | "CERRADO"
  created_at: string
  updated_at: string
  canManage: boolean
  supervision: {
    id: string
    operation_name?: string | null
    review_post?: string | null
    officer_name?: string | null
    supervisor_id?: string | null
    event_occurred_at?: string | null
    created_at?: string | null
  }
}

type FindingsResponse = {
  findings?: SupervisionFindingRow[]
  error?: string
}

export function useSupervisionFindings() {
  const { supabase } = useSupabase()
  const { user } = useUser()
  const [findings, setFindings] = useState<SupervisionFindingRow[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async (withLoading = false) => {
    if (!user) {
      setFindings([])
      setError(null)
      return
    }
    if (withLoading) setIsLoading(true)
    setError(null)
    try {
      const response = await fetchInternalApi(supabase, "/api/supervision-findings", { cache: "no-store" })
      const body = await response.json().catch(() => ({})) as FindingsResponse
      if (!response.ok) {
        setError(new Error(body.error ?? "No se pudieron cargar los hallazgos."))
        return
      }
      setFindings(Array.isArray(body.findings) ? body.findings : [])
    } catch {
      setError(new Error("No se pudieron cargar los hallazgos."))
    } finally {
      if (withLoading) setIsLoading(false)
    }
  }, [supabase, user])

  useEffect(() => {
    void reload(true)
  }, [reload])

  useSharedRefreshLoop({ enabled: Boolean(user), intervalMs: 180000, reload })

  const updateFinding = useCallback(async (payload: {
    findingId: string
    status: SupervisionFindingRow["status"]
    correctiveAction?: string
  }) => {
    const response = await fetchInternalApi(supabase, "/api/supervision-findings", {
      method: "PATCH",
      body: JSON.stringify({
        finding_id: payload.findingId,
        status: payload.status,
        corrective_action: payload.correctiveAction?.trim() || null,
      }),
    })
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar el hallazgo.")
    await reload(false)
  }, [reload, supabase])

  return { findings, isLoading, error, reload, updateFinding }
}