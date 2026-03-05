export type PasswordValidationResult = {
  ok: boolean
  message?: string
}

const WEAK_FRAGMENTS = [
  "password",
  "123456",
  "qwerty",
  "admin",
  "welcome",
  "seguridad",
  "hoseguridad",
]

export const WEAK_PASSWORD_PROVIDER_MESSAGE =
  "Clave debil detectada. Use 12+ caracteres con mayuscula, minuscula, numero y simbolo, evitando claves comunes."

export function validateStrongPassword(password: string): PasswordValidationResult {
  if (password.length < 12) {
    return { ok: false, message: "La clave debe tener al menos 12 caracteres." }
  }

  if (/\s/.test(password)) {
    return { ok: false, message: "La clave no debe contener espacios." }
  }

  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, message: "Use mayuscula, minuscula, numero y simbolo en la clave." }
  }

  if (/(.)\1{3,}/.test(password)) {
    return { ok: false, message: "Evite repetir el mismo caracter muchas veces seguidas." }
  }

  const normalized = password.toLowerCase()
  if (WEAK_FRAGMENTS.some((item) => normalized.includes(item))) {
    return { ok: false, message: "La clave incluye patrones comunes o faciles de adivinar." }
  }

  return { ok: true }
}

export function mapPasswordProviderError(message?: string): string {
  const lower = String(message ?? "").toLowerCase()
  if (lower.includes("known to be weak") || lower.includes("weak and easy to guess")) {
    return WEAK_PASSWORD_PROVIDER_MESSAGE
  }
  return message || "No se pudo actualizar la clave."
}
