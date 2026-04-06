export const AUTH_ROUTE_TIMEOUT_MS = 15000

export function createAuthTimeoutError(message = "El servicio de autenticacion tardó demasiado en responder.") {
  const error = new Error(message)
  error.name = "TimeoutError"
  return error
}

export function isAuthTimeoutError(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError"
}

export async function withAuthTimeout<T>(promise: Promise<T>, message?: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(createAuthTimeoutError(message)), AUTH_ROUTE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}