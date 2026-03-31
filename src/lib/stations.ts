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

export function buildStationKey(operationName: unknown, postName: unknown) {
  const normalizedPost = normalizeStationSegment(postName)
  if (normalizedPost) return normalizedPost
  const normalizedOperation = normalizeStationSegment(operationName)
  if (normalizedOperation) return normalizedOperation
  return "puesto-operativo"
}

export function resolveStationReference(input: { assigned?: unknown; stationLabel?: unknown }) {
  const { operationName, postName } = splitAssignedScope(input.assigned)
  const fallbackPost = postName || operationName || "Puesto operativo"
  const displayLabel = String(input.stationLabel ?? "").trim() || fallbackPost

  return {
    key: buildStationKey(operationName, postName || displayLabel),
    label: displayLabel,
    operationName: operationName || displayLabel,
    postName: fallbackPost,
    assignedScope: String(input.assigned ?? "").trim(),
  } satisfies StationReference
}

export function stationMatchesAssigned(stationPostName: unknown, assigned: unknown) {
  const station = resolveStationReference({ stationLabel: stationPostName })
  const assignedStation = resolveStationReference({ assigned })
  return station.key === assignedStation.key
}