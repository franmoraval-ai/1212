"use client"

// Helpers de navegador para Web Push. Inertes si el navegador no soporta push
// o si no hay NEXT_PUBLIC_VAPID_PUBLIC_KEY configurada.

export function getVapidPublicKey(): string {
  return String(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim()
}

export function isPushConfigured(): boolean {
  return getVapidPublicKey().length > 0
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  )
}

export function getPushPermission(): NotificationPermission | "unsupported" {
  if (!isPushSupported()) return "unsupported"
  return Notification.permission
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  try {
    const registration = await navigator.serviceWorker.ready
    return await registration.pushManager.getSubscription()
  } catch {
    return null
  }
}

/**
 * Solicita permiso (si hace falta) y crea/recupera la suscripción del navegador.
 * Devuelve null si el navegador no soporta push, no hay llave pública, o el
 * usuario deniega el permiso.
 */
export async function subscribeBrowserToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  const key = getVapidPublicKey()
  if (!key) return null

  const permission = await Notification.requestPermission()
  if (permission !== "granted") return null

  const registration = await navigator.serviceWorker.ready
  const existing = await registration.pushManager.getSubscription()
  if (existing) return existing

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(key),
  })
}

/** Cancela la suscripción del navegador. Devuelve el endpoint eliminado, si hubo. */
export async function unsubscribeBrowserFromPush(): Promise<string | null> {
  const subscription = await getExistingPushSubscription()
  if (!subscription) return null
  const endpoint = subscription.endpoint
  try {
    await subscription.unsubscribe()
  } catch {
    // Aun si el navegador falla al cancelar, reportamos el endpoint para que el
    // servidor lo desactive.
  }
  return endpoint
}
