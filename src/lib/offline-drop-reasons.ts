export type OfflineDropCategory =
  | "permission"
  | "storage"
  | "oversize"
  | "connectivity"
  | "orphan"
  | "unknown"

export type OfflineDropGuidance = {
  category: OfflineDropCategory
  /** Short human-friendly label for the failure category. */
  label: string
  /** Actionable next step for an L1 officer, in plain Spanish. */
  action: string
  /** Whether retrying (better signal, retry sync) can plausibly resolve it. */
  retryable: boolean
}

/**
 * Translate a raw dead-letter drop reason into a plain-language category and a
 * concrete next step for L1 officers. Keyword-based so it stays resilient to the
 * exact wording of upstream errors (server, connectivity, storage, etc.).
 */
export function classifyOfflineDropReason(reason: string | null | undefined): OfflineDropGuidance {
  const normalized = String(reason ?? "").toLowerCase()

  if (
    normalized.includes("permiso") ||
    normalized.includes("forbidden") ||
    normalized.includes("no autenticado") ||
    normalized.includes("row-level security") ||
    normalized.includes("row level security") ||
    normalized.includes("inválido") ||
    normalized.includes("invalido") ||
    normalized.includes("unauthorized")
  ) {
    return {
      category: "permission",
      label: "Permiso o sesión",
      action: "Reintentar no lo resolverá. Cierre y vuelva a iniciar sesión; si continúa, avise a su supervisor o a soporte.",
      retryable: false,
    }
  }

  if (
    normalized.includes("quota") ||
    normalized.includes("exceeded the quota") ||
    normalized.includes("almacenamiento") ||
    normalized.includes("espacio") ||
    normalized.includes("storage")
  ) {
    return {
      category: "storage",
      label: "Almacenamiento lleno",
      action: "Libere espacio en el dispositivo (fotos/apps) y vuelva a intentar la sincronización.",
      retryable: true,
    }
  }

  if (
    normalized.includes("pesada") ||
    normalized.includes("demasiado grande") ||
    normalized.includes("too large") ||
    normalized.includes("excede") ||
    normalized.includes("oversize") ||
    normalized.includes("límite de tamaño") ||
    normalized.includes("limite de tamaño")
  ) {
    return {
      category: "oversize",
      label: "Registro muy grande",
      action: "El registro tiene demasiada evidencia. Reduzca la cantidad de fotos y vuelva a guardar.",
      retryable: false,
    }
  }

  if (
    normalized.includes("huérfana") ||
    normalized.includes("huerfana") ||
    normalized.includes("ya no existe")
  ) {
    return {
      category: "orphan",
      label: "Sesión incompleta",
      action: "La sesión de ronda asociada no llegó a iniciarse en el servidor. Si la ronda sigue pendiente, vuelva a iniciarla.",
      retryable: false,
    }
  }

  if (
    normalized.includes("reintentos") ||
    normalized.includes("conectividad") ||
    normalized.includes("conexión") ||
    normalized.includes("conexion") ||
    normalized.includes("network") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("load failed") ||
    normalized.includes("timed out") ||
    normalized.includes("timeout")
  ) {
    return {
      category: "connectivity",
      label: "Sin conexión estable",
      action: "No se pudo subir por falta de señal. Ubíquese en una zona con mejor conexión y reintente la sincronización.",
      retryable: true,
    }
  }

  return {
    category: "unknown",
    label: "No se pudo sincronizar",
    action: "Reintente la sincronización. Si el problema persiste, informe a su supervisor o a soporte con el detalle mostrado.",
    retryable: true,
  }
}
