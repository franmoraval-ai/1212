export type NfcReadPayload = {
  serialNumber?: string
  message?: {
    records?: Array<{
      recordType?: string
      data?: DataView
    }>
  }
}

export type NfcTagSnapshot = {
  serialNumber: string
  rawText: string
  token: string
  structuredPayload: Record<string, unknown> | null
}

type NfcStampPayload = {
  version: number
  token: string
  lastMarkedAt: string
  checkpointName?: string
  roundId?: string
  roundName?: string
  officerName?: string
  stationLabel?: string
}

export function decodeNfcTextRecord(data: DataView) {
  if (data.byteLength === 0) return ""
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  const status = bytes[0] ?? 0
  const langLength = status & 0x3f
  const textBytes = bytes.slice(1 + langLength)
  return new TextDecoder("utf-8").decode(textBytes)
}

function extractTokenFromString(value: string) {
  const text = String(value ?? "").trim()
  if (!text) return ""

  try {
    const parsed = JSON.parse(text) as Partial<NfcStampPayload>
    const token = String(parsed.token ?? "").trim()
    if (token) return token
  } catch {
    // Non-JSON payloads are valid; fall through to raw text.
  }

  return text
}

function parseStructuredPayload(value: string) {
  const text = String(value ?? "").trim()
  if (!text) return null

  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

export function extractNfcRawText(payload: NfcReadPayload) {
  const records = payload.message?.records ?? []
  for (const record of records) {
    if (!record?.data) continue
    if (record.recordType === "text") {
      const text = decodeNfcTextRecord(record.data).trim()
      if (text) return text
      continue
    }

    const raw = new TextDecoder("utf-8").decode(
      new Uint8Array(record.data.buffer, record.data.byteOffset, record.data.byteLength)
    ).trim()
    if (raw) return raw
  }

  return String(payload.serialNumber ?? "").trim()
}

export function extractNfcToken(payload: NfcReadPayload) {
  return extractTokenFromString(extractNfcRawText(payload))
}

export function readNfcSnapshot(payload: NfcReadPayload): NfcTagSnapshot {
  const rawText = extractNfcRawText(payload)
  return {
    serialNumber: String(payload.serialNumber ?? "").trim(),
    rawText,
    token: extractTokenFromString(rawText),
    structuredPayload: parseStructuredPayload(rawText),
  }
}

export function buildNfcStampText(input: {
  token: string
  lastMarkedAt: string
  checkpointName?: string
  roundId?: string
  roundName?: string
  officerName?: string
  stationLabel?: string
}) {
  const payload: NfcStampPayload = {
    version: 1,
    token: String(input.token ?? "").trim(),
    lastMarkedAt: String(input.lastMarkedAt ?? "").trim(),
    checkpointName: String(input.checkpointName ?? "").trim() || undefined,
    roundId: String(input.roundId ?? "").trim() || undefined,
    roundName: String(input.roundName ?? "").trim() || undefined,
    officerName: String(input.officerName ?? "").trim() || undefined,
    stationLabel: String(input.stationLabel ?? "").trim() || undefined,
  }

  return JSON.stringify(payload)
}