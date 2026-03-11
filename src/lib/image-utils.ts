export function estimateDataUrlSizeKb(dataUrl: string) {
  const base64 = String(dataUrl ?? "").split(",")[1] ?? ""
  const bytes = Math.ceil((base64.length * 3) / 4)
  return Math.round(bytes / 1024)
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."))
    reader.readAsDataURL(file)
  })
}

export async function optimizeImageFileToDataUrl(
  file: File,
  options?: { maxWidth?: number; maxHeight?: number; quality?: number }
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
    const optimized = canvas.toDataURL("image/jpeg", quality)

    // Si por algun motivo sale mas grande, usar original.
    return estimateDataUrlSizeKb(optimized) <= estimateDataUrlSizeKb(originalDataUrl)
      ? optimized
      : originalDataUrl
  } catch {
    return readFileAsDataUrl(file)
  }
}
