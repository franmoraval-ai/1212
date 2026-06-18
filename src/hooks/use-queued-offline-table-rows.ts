"use client"

import { useCallback, useEffect, useState } from "react"
import { getQueuedOfflineMutationsByTable, OFFLINE_MUTATIONS_CHANGED_EVENT, type OfflineMutation } from "@/lib/offline-mutations"
import { useSharedPoll } from "./use-shared-poll"

type UseQueuedOfflineTableRowsOptions<TPayload, TRow> = {
  table: string
  refreshIntervalMs?: number
  mapRows: (items: Array<OfflineMutation & { payload: TPayload | TPayload[] | undefined }>) => TRow[]
}

export function useQueuedOfflineTableRows<TPayload extends Record<string, unknown> = Record<string, unknown>, TRow = TPayload>({
  table,
  refreshIntervalMs = 20000,
  mapRows,
}: UseQueuedOfflineTableRowsOptions<TPayload, TRow>) {
  const [version, setVersion] = useState(0)

  const notifyRowsChanged = useCallback(() => {
    setVersion((prev) => prev + 1)
  }, [])

  useEffect(() => {
    window.addEventListener("storage", notifyRowsChanged)
    window.addEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, notifyRowsChanged)

    return () => {
      window.removeEventListener("storage", notifyRowsChanged)
      window.removeEventListener(OFFLINE_MUTATIONS_CHANGED_EVENT, notifyRowsChanged)
    }
  }, [notifyRowsChanged])

  useSharedPoll(notifyRowsChanged, refreshIntervalMs)

  void version
  const rows = mapRows(getQueuedOfflineMutationsByTable<TPayload>(table))

  return rows
}