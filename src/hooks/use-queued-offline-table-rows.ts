"use client"

import { useEffect, useState } from "react"
import { getQueuedOfflineMutationsByTable, OFFLINE_MUTATIONS_CHANGED_EVENT, type OfflineMutation } from "@/lib/offline-mutations"

type UseQueuedOfflineTableRowsOptions<TPayload, TRow> = {
  table: string
  refreshIntervalMs?: number
  mapRows: (items: Array<OfflineMutation & { payload: TPayload | TPayload[] | undefined }>) => TRow[]
}

export function useQueuedOfflineTableRows<TPayload = Record<string, unknown>, TRow = TPayload>({
  table,
  refreshIntervalMs = 20000,
  mapRows,
}: UseQueuedOfflineTableRowsOptions<TPayload, TRow>) {
  const [rows, setRows] = useState<TRow[]>([])

  useEffect(() => {
    const readRows = () => {
      const queued = getQueuedOfflineMutationsByTable<TPayload>(table)
      setRows(mapRows(queued))
    }

    readRows()
    window.addEventListener("storage", readRows)
    window.addEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, readRows)

    const timer = refreshIntervalMs > 0 ? window.setInterval(readRows, refreshIntervalMs) : null

    return () => {
      if (timer !== null) window.clearInterval(timer)
      window.removeEventListener("storage", readRows)
      window.removeEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, readRows)
    }
  }, [mapRows, refreshIntervalMs, table])

  return rows
}