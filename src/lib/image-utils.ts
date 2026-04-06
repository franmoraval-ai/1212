export function estimateDataUrlSizeKb(dataUrl: string) {
  const base64 = String(dataUrl ?? "").split(",")[1] ?? ""
  const bytes = Math.ceil((base64.length * 3) / 4)
  return Math.round(bytes / 1024)
}

type PhotoWatermarkOptions = {
  label?: string
  capturedAt?: string | Date
  gps?: {
    lat?: number
    lng?: number
    accuracy?: number | null
  } | null
  extraLines?: string[]
}

function formatWatermarkDate(value: string | Date | undefined) {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return new Date().toLocaleString("es-CR")
  return date.toLocaleString("es-CR")
}

function buildPhotoWatermarkLines(watermark: PhotoWatermarkOptions | undefined) {
  if (!watermark) return [] as string[]

  const lines = [
    String(watermark.label ?? "HO Seguridad").trim() || "HO Seguridad",
    formatWatermarkDate(watermark.capturedAt),
  ]

  if (watermark.gps) {
    const lat = Number(watermark.gps.lat)
    const lng = Number(watermark.gps.lng)
    const accuracy = Number(watermark.gps.accuracy)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      lines.push(`GPS ${lat.toFixed(6)}, ${lng.toFixed(6)}${Number.isFinite(accuracy) ? ` | acc ${Math.round(accuracy)}m` : ""}`)
    } else {
      lines.push("GPS no disponible")
    }
  } else {
    lines.push("GPS no disponible")
  }

  for (const line of watermark.extraLines ?? []) {
    const clean = String(line ?? "").trim()
    if (clean) lines.push(clean)
  }

  return lines.slice(0, 4)
}

function fitLineToWidth(ctx: CanvasRenderingContext2D, value: string, maxWidth: number) {
  const clean = String(value ?? "").trim()
  if (!clean) return ""
  if (ctx.measureText(clean).width <= maxWidth) return clean

  let output = clean
  while (output.length > 3 && ctx.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1)
  }

  return `${output}...`
}

function drawPhotoWatermark(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermark: PhotoWatermarkOptions | undefined
) {
  const lines = buildPhotoWatermarkLines(watermark)
  if (lines.length === 0) return

  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.024))
  const lineHeight = Math.round(fontSize * 1.28)
  const paddingX = Math.max(10, Math.round(width * 0.018))
  const paddingY = Math.max(8, Math.round(height * 0.014))
  const boxHeight = paddingY * 2 + lineHeight * lines.length

  ctx.save()
  ctx.fillStyle = "rgba(0, 0, 0, 0.58)"
  ctx.fillRect(0, height - boxHeight, width, boxHeight)
  ctx.font = `600 ${fontSize}px sans-serif`
  ctx.fillStyle = "#ffffff"
  ctx.textBaseline = "top"

  const maxTextWidth = width - paddingX * 2
  lines.forEach((line, index) => {
    const fitted = fitLineToWidth(ctx, line, maxTextWidth)
    ctx.fillText(fitted, paddingX, height - boxHeight + paddingY + index * lineHeight)
  })
  ctx.restore()
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."))
    reader.readAsDataURL(file)
  })
}

function dataUrlToBlob(dataUrl: string) {
  const clean = String(dataUrl ?? "")
  const [header, payload] = clean.split(",")
  if (!header || !payload) return null

  const mimeType = header.match(/^data:(.*?);base64$/)?.[1] ?? "image/jpeg"
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return new Blob([bytes], { type: mimeType })
}

export function openDataUrlInNewTab(dataUrl: string) {
  if (typeof window === "undefined") return false
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return false

  const url = window.URL.createObjectURL(blob)
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000)
  return Boolean(opened)
}

export function downloadDataUrlAsFile(dataUrl: string, fileName: string) {
  if (typeof window === "undefined") return false
  const blob = dataUrlToBlob(dataUrl)
  if (!blob) return false

  const url = window.URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => window.URL.revokeObjectURL(url), 1000)
  return true
}

export async function optimizeImageFileToDataUrl(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number; watermark?: PhotoWatermarkOptions }
) {
  const maxWidth = options?.maxWidth ?? 1600
  const maxHeight = options?.maxHeight ?? 1600
  const quality = options?.quality ?? 0.75

  try {
    const originalDataUrl = await readFileAsDataUrl(file)

    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error("No se pudo procesar la imagen."))
      img.src = originalDataUrl
    })

    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1)
    const targetWidth = Math.max(1, Math.round(image.width * ratio))
    const targetHeight = Math.max(1, Math.round(image.height * ratio))

    const canvas = document.createElement("canvas")
    canvas.width = targetWidth
    canvas.height = targetHeight

    const ctx = canvas.getContext("2d")
    if (!ctx) return originalDataUrl

    ctx.drawImage(image, 0, 0, targetWidth, targetHeight)
    drawPhotoWatermark(ctx, targetWidth, targetHeight, options?.watermark)
    const optimized = canvas.toDataURL("image/jpeg", quality)

    if (options?.watermark) return optimized

    // Si por algun motivo sale mas grande, usar original.
    return estimateDataUrlSizeKb(optimized) <= estimateDataUrlSizeKb(originalDataUrl)
      ? optimized
      : originalDataUrl
  } catch {
    return readFileAsDataUrl(file)
  }
}
