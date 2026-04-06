import { splitAssignedScope } from "@/lib/personnel-assignment"

export type StationReference = {
  key: string
  label: string
  operationName: string
  postName: string
  assignedScope: string
}

function normalizeStationSegment(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function normalizeStationPhrase(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function buildStationKey(operationName: unknown, postName: unknown) {
  const normalizedOperation = normalizeStationSegment(operationName)
  const normalizedPost = normalizeStationSegment(postName)
  if (normalizedOperation && normalizedPost) return `${normalizedOperation}__${normalizedPost}`
  if (normalizedPost) return normalizedPost
  if (normalizedOperation) return normalizedOperation
  return "puesto-operativo"
}

export function resolveStationReference(input: { assigned?: unknown; stationLabel?: unknown }) {
  const { operationName, postName } = splitAssignedScope(input.assigned)
  const fallbackPost = postName || operationName || "Puesto operativo"
  const displayLabel = String(input.stationLabel ?? "").trim() || fallbackPost
  const resolvedPostName = postName || displayLabel

  return {
    key: buildStationKey(operationName, resolvedPostName),
    label: displayLabel,
    operationName: operationName || displayLabel,
    postName: resolvedPostName,
    assignedScope: String(input.assigned ?? "").trim(),
  } satisfies StationReference
}

export function stationMatchesAssigned(stationPostName: unknown, assigned: unknown) {
  const candidateRaw = String(stationPostName ?? "").trim()
  const assignedRaw = String(assigned ?? "").trim()
  if (!candidateRaw || !assignedRaw) return false

  const { operationName, postName } = splitAssignedScope(assigned)
  const assignedStation = resolveStationReference({ assigned })

  if (candidateRaw.includes("__")) {
    return candidateRaw.toLowerCase() === assignedStation.key
  }

  const candidatePhrase = normalizeStationPhrase(candidateRaw)
  const assignedPhrase = normalizeStationPhrase(assignedRaw)
  const operationPhrase = normalizeStationPhrase(operationName)
  const postPhrase = normalizeStationPhrase(postName)

  if (!candidatePhrase) return false
  if (candidatePhrase === assignedPhrase) return true
  if (postPhrase && candidatePhrase === postPhrase) return true
  if (operationPhrase && candidatePhrase === operationPhrase) return true

  return Boolean(
    operationPhrase
    && postPhrase
    && candidatePhrase.includes(operationPhrase)
    && candidatePhrase.includes(postPhrase)
  )
}