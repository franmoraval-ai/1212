"use client"

import { useEffect, useRef } from "react"

type SharedPollSubscriber = {
  callback: () => void | Promise<void>
  runWhenHidden: boolean
}

type SharedPollBucket = {
  timer: number
  subscribers: Set<SharedPollSubscriber>
}

const sharedPollBuckets = new Map<number, SharedPollBucket>()

function invokeSubscriber(subscriber: SharedPollSubscriber) {
  if (!subscriber.runWhenHidden && document.visibilityState !== "visible") {
    return
  }

  try {
    const result = subscriber.callback()
    void Promise.resolve(result).catch(() => undefined)
  } catch {
    // Ignore polling callback errors here; each hook handles its own state/errors.
  }
}

function ensureSharedPollBucket(intervalMs: number) {
  const existing = sharedPollBuckets.get(intervalMs)
  if (existing) return existing

  const bucket: SharedPollBucket = {
    timer: window.setInterval(() => {
      const current = sharedPollBuckets.get(intervalMs)
      if (!current) return
      for (const subscriber of current.subscribers) {
        invokeSubscriber(subscriber)
      }
    }, intervalMs),
    subscribers: new Set<SharedPollSubscriber>(),
  }

  sharedPollBuckets.set(intervalMs, bucket)
  return bucket
}

export function useSharedPoll(
  callback: () => void | Promise<void>,
  intervalMs: number,
  options?: { enabled?: boolean; runWhenHidden?: boolean },
) {
  const enabled = options?.enabled ?? true
  const runWhenHidden = options?.runWhenHidden ?? false
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled || intervalMs <= 0 || typeof window === "undefined") return

    const subscriber: SharedPollSubscriber = {
      callback: () => callbackRef.current(),
      runWhenHidden,
    }

    const bucket = ensureSharedPollBucket(intervalMs)
    bucket.subscribers.add(subscriber)

    return () => {
      const current = sharedPollBuckets.get(intervalMs)
      if (!current) return

      current.subscribers.delete(subscriber)
      if (current.subscribers.size === 0) {
        window.clearInterval(current.timer)
        sharedPollBuckets.delete(intervalMs)
      }
    }
  }, [enabled, intervalMs, runWhenHidden])
}

export function useSharedRefreshLoop(options: {
  enabled: boolean
  intervalMs: number
  reload: (withLoading: boolean) => Promise<void>
  runWhenHidden?: boolean
}) {
  const { enabled, intervalMs, reload, runWhenHidden = false } = options
  const enabledRef = useRef(enabled)
  const reloadRef = useRef(reload)
  const requestInFlightRef = useRef(false)
  const runLoadRef = useRef<(withLoading: boolean) => Promise<void>>(async () => undefined)

  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    reloadRef.current = reload
  }, [reload])

  useEffect(() => {
    runLoadRef.current = async (withLoading: boolean) => {
      if (!enabledRef.current || requestInFlightRef.current) return

      requestInFlightRef.current = true
      try {
        await reloadRef.current(withLoading)
      } finally {
        requestInFlightRef.current = false
      }
    }

    if (!enabled) return
    void runLoadRef.current(true)
  }, [enabled, reload])

  useSharedPoll(() => runLoadRef.current(false), intervalMs, { enabled, runWhenHidden })
}