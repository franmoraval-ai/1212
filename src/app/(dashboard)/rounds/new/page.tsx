"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Plus, Trash2, Loader2, Camera, ScanLine, LocateFixed, Download } from "lucide-react"
import { useOperationCatalogData } from "@/hooks/use-operation-catalog-data"
import { useSupabase, useUser } from "@/supabase"
import { useQrScanner } from "@/hooks/use-qr-scanner"
import { extractNfcToken, readNfcSnapshot, type NfcTagSnapshot } from "@/lib/nfc"
import { toSnakeCaseKeys, nowIso } from "@/lib/supabase-db"
import { fetchInternalApi } from "@/lib/internal-api"
import { useToast } from "@/hooks/use-toast"

type CheckpointDraft = {
  name: string
  qrCodesText: string
  nfcCodesText: string
  lat: string
  lng: string
}

type NfcMaintenanceSnapshot = NfcTagSnapshot & {
  scannedAt: string
}

export default function NewRoundPage() {
  const router = useRouter()
  const { supabase, user } = useSupabase()
  const { isUserLoading } = useUser()
  const { toast } = useToast()
  const canManageNfcMaintenance = (user?.roleLevel ?? 1) >= 4

  const [saving, setSaving] = useState(false)
  const [name, setName] = useState("")
  const [post, setPost] = useState("")
  const [status, setStatus] = useState("Activa")
  const [frequency, setFrequency] = useState("Cada 30 minutos")
  const [operationName, setOperationName] = useState("")
  const [instructions, setInstructions] = useState("")
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>([{ name: "", qrCodesText: "", nfcCodesText: "", lat: "", lng: "" }])
  const [geoLoadingIndex, setGeoLoadingIndex] = useState<number | null>(null)
  const [qrOpen, setQrOpen] = useState(false)
  const [qrTargetIndex, setQrTargetIndex] = useState<number | null>(null)
  const [isNfcScanning, setIsNfcScanning] = useState(false)
  const nfcAbortRef = useRef<AbortController | null>(null)
  const maintenanceNfcAbortRef = useRef<AbortController | null>(null)
  const [nfcSupported] = useState(() => typeof window !== "undefined" && "NDEFReader" in window)
  const [isStandalonePwa, setIsStandalonePwa] = useState(false)
  const [nfcMaintenanceOpen, setNfcMaintenanceOpen] = useState(false)
  const [nfcMaintenanceBusy, setNfcMaintenanceBusy] = useState<"scan" | "clear" | null>(null)
  const [nfcMaintenanceData, setNfcMaintenanceData] = useState<NfcMaintenanceSnapshot | null>(null)

  const appendToken = useCallback((existing: string, rawToken: string) => {
    const token = rawToken.trim()
    if (!token) return existing
    const parts = existing.split(",").map((x) => x.trim()).filter(Boolean)
    const hasToken = parts.some((item) => item.toLowerCase() === token.toLowerCase())
    if (hasToken) return existing
    return [...parts, token].join(", ")
  }, [])

  const onQrDetected = useCallback((rawValue: string) => {
    const targetIndex = qrTargetIndex
    if (targetIndex == null) return
    setCheckpoints((prev) => prev.map((cp, i) => (
      i === targetIndex
        ? { ...cp, qrCodesText: appendToken(cp.qrCodesText, rawValue) }
        : cp
    )))
    toast({ title: "QR agregado", description: "Codigo agregado al checkpoint." })
    setQrOpen(false)
    setQrTargetIndex(null)
  }, [appendToken, qrTargetIndex, toast])

  const { videoRef, isScanning, scanError, qrSupported, startScanner, stopScanner } = useQrScanner({
    onDetected: onQrDetected,
    autoStopOnDetected: true,
    errorNoCamera: "Este navegador no permite acceso a camara.",
    errorCameraStart: "No se pudo iniciar la camara. Revise permisos.",
  })

  const stopNfcScan = useCallback(() => {
    if (nfcAbortRef.current) {
      nfcAbortRef.current.abort()
      nfcAbortRef.current = null
    }
    setIsNfcScanning(false)
  }, [])

  const stopMaintenanceNfcScan = useCallback(() => {
    if (maintenanceNfcAbortRef.current) {
      maintenanceNfcAbortRef.current.abort()
      maintenanceNfcAbortRef.current = null
    }
    setNfcMaintenanceBusy((current) => (current === "scan" ? null : current))
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    setIsStandalonePwa(standalone)
  }, [])

  useEffect(() => {
    return () => {
      stopNfcScan()
      stopMaintenanceNfcScan()
      stopScanner()
    }
  }, [stopMaintenanceNfcScan, stopNfcScan, stopScanner])

  const nfcMaintenanceText = useMemo(() => {
    if (!nfcMaintenanceData) return ""
    if (nfcMaintenanceData.structuredPayload) {
      return JSON.stringify(nfcMaintenanceData.structuredPayload, null, 2)
    }
    return nfcMaintenanceData.rawText
  }, [nfcMaintenanceData])

  const startNfcScan = useCallback(async (index: number) => {
    if (!nfcSupported) {
      toast({ title: "NFC no soportado", description: "Este dispositivo/navegador no permite lectura NFC web.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: (options?: { signal?: AbortSignal }) => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detecto API NDEFReader en este navegador.", variant: "destructive" })
      return
    }

    try {
      stopNfcScan()
      const controller = new AbortController()
      nfcAbortRef.current = controller
      const reader = new NdefCtor()
      await reader.scan({ signal: controller.signal })
      setIsNfcScanning(true)
      toast({ title: "NFC activo", description: "Acerque una etiqueta para capturar el codigo." })

      reader.onreading = (event) => {
        const token = extractNfcToken(event)
        if (!token) return
        setCheckpoints((prev) => prev.map((cp, i) => (
          i === index
            ? { ...cp, nfcCodesText: appendToken(cp.nfcCodesText, token) }
            : cp
        )))
        toast({ title: "NFC agregado", description: "ID agregado al checkpoint." })
        stopNfcScan()
      }

      reader.onreadingerror = () => {
        toast({ title: "Error NFC", description: "No se pudo leer la etiqueta NFC.", variant: "destructive" })
      }
    } catch {
      stopNfcScan()
      toast({ title: "NFC bloqueado", description: "No se pudo iniciar lector NFC. Revise permisos y HTTPS.", variant: "destructive" })
    }
  }, [appendToken, nfcSupported, stopNfcScan, toast])

  const startNfcMaintenanceScan = useCallback(async () => {
    if (!nfcSupported) {
      toast({ title: "NFC no soportado", description: "Este dispositivo/navegador no permite lectura NFC web.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: (options?: { signal?: AbortSignal }) => Promise<void>
        write: (message: { records: Array<{ recordType: string; data: string }> }) => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detecto API NDEFReader en este navegador.", variant: "destructive" })
      return
    }

    try {
      stopMaintenanceNfcScan()
      const controller = new AbortController()
      maintenanceNfcAbortRef.current = controller
      const reader = new NdefCtor()
      await reader.scan({ signal: controller.signal })
      setNfcMaintenanceBusy("scan")
      toast({ title: "Lectura NFC activa", description: "Acerque la etiqueta para revisar, exportar o limpiar su contenido." })

      reader.onreading = (event) => {
        setNfcMaintenanceData({
          ...readNfcSnapshot(event),
          scannedAt: nowIso(),
        })
        stopMaintenanceNfcScan()
        toast({ title: "Etiqueta leida", description: "Contenido NFC cargado para revision de L4." })
      }

      reader.onreadingerror = () => {
        stopMaintenanceNfcScan()
        toast({ title: "Error NFC", description: "No se pudo leer la etiqueta NFC.", variant: "destructive" })
      }
    } catch {
      stopMaintenanceNfcScan()
      toast({ title: "NFC bloqueado", description: "No se pudo iniciar lector NFC. Revise permisos y HTTPS.", variant: "destructive" })
    }
  }, [nfcSupported, stopMaintenanceNfcScan, toast])

  const downloadNfcMaintenanceData = useCallback(() => {
    if (!nfcMaintenanceData) {
      toast({ title: "Sin lectura", description: "Lea una etiqueta antes de exportar.", variant: "destructive" })
      return
    }

    const exportPayload = {
      exportedAt: nowIso(),
      ...nfcMaintenanceData,
    }
    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    const safeToken = (nfcMaintenanceData.token || "sin-token").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 40) || "sin-token"
    anchor.href = url
    anchor.download = `nfc-${safeToken}-${new Date().toISOString().replace(/[.:]/g, "-")}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    toast({ title: "Descarga lista", description: "Se exporto el contenido actual de la etiqueta NFC." })
  }, [nfcMaintenanceData, toast])

  const clearNfcMaintenanceTag = useCallback(async () => {
    if (!nfcMaintenanceData?.token) {
      toast({ title: "Token requerido", description: "Lea una etiqueta valida antes de limpiarla.", variant: "destructive" })
      return
    }

    const NdefCtor = (window as unknown as {
      NDEFReader?: new () => {
        scan: (options?: { signal?: AbortSignal }) => Promise<void>
        write: (message: { records: Array<{ recordType: string; data: string }> }) => Promise<void>
        onreading: ((event: { serialNumber?: string; message?: { records?: Array<{ recordType?: string; data?: DataView }> } }) => void) | null
        onreadingerror: (() => void) | null
      }
    }).NDEFReader

    if (!NdefCtor) {
      toast({ title: "NFC no disponible", description: "No se detecto API NDEFReader en este navegador.", variant: "destructive" })
      return
    }

    try {
      setNfcMaintenanceBusy("clear")
      const writer = new NdefCtor()
      await writer.write({
        records: [
          {
            recordType: "text",
            data: nfcMaintenanceData.token,
          },
        ],
      })
      setNfcMaintenanceData((current) => current ? {
        ...current,
        rawText: current.token,
        structuredPayload: null,
        scannedAt: nowIso(),
      } : current)
      toast({ title: "Etiqueta limpiada", description: "Se elimino la metadata y se conservo el token operativo del checkpoint." })
    } catch {
      toast({ title: "No se pudo limpiar", description: "Revise permisos NFC y acerque la misma etiqueta para escribir de nuevo.", variant: "destructive" })
    } finally {
      setNfcMaintenanceBusy(null)
    }
  }, [nfcMaintenanceData, toast])

  const handleNfcMaintenanceOpenChange = useCallback((open: boolean) => {
    setNfcMaintenanceOpen(open)
    if (!open) {
      stopMaintenanceNfcScan()
      setNfcMaintenanceBusy((current) => (current === "clear" ? current : null))
    }
  }, [stopMaintenanceNfcScan])

  const openQrScannerForCheckpoint = (index: number) => {
    setQrTargetIndex(index)
    setQrOpen(true)
    void startScanner()
  }

  const fillCheckpointCoordinates = async (index: number) => {
    if (!("geolocation" in navigator)) {
      toast({ title: "GPS no disponible", description: "Este dispositivo/navegador no soporta geolocalizacion.", variant: "destructive" })
      return
    }

    setGeoLoadingIndex(index)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        })
      })

      const lat = position.coords.latitude.toFixed(6)
      const lng = position.coords.longitude.toFixed(6)
      setCheckpoints((prev) => prev.map((cp, i) => (i === index ? { ...cp, lat, lng } : cp)))
      toast({ title: "Coordenadas cargadas", description: "Latitud y longitud completadas con GPS." })
    } catch {
      toast({
        title: "No se pudo obtener GPS",
        description: "Revise permisos de ubicacion y vuelva a intentar.",
        variant: "destructive",
      })
    } finally {
      setGeoLoadingIndex(null)
    }
  }

  const handleQrOpenChange = (open: boolean) => {
    setQrOpen(open)
    if (!open) {
      setQrTargetIndex(null)
      stopScanner()
    }
  }

  const { operations: operationCatalog } = useOperationCatalogData()

  const activeCatalog = useMemo(
    () =>
      (operationCatalog ?? [])
        .filter((o) => o.isActive !== false)
        .map((o) => ({
          operationName: String(o.operationName ?? "").trim(),
          clientName: String(o.clientName ?? "").trim(),
        }))
        .filter((o) => o.operationName),
    [operationCatalog]
  )

  const operationOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((o) => o.operationName))).filter(Boolean),
    [activeCatalog]
  )

  const postOptions = useMemo(
    () => Array.from(new Set(activeCatalog.filter((o) => o.operationName === operationName).map((o) => o.clientName).filter(Boolean))),
    [activeCatalog, operationName]
  )

  const isPostValidForOperation = !operationName || postOptions.length === 0 || postOptions.includes(post)

  const addCheckpoint = () => {
    setCheckpoints((prev) => [...prev, { name: "", qrCodesText: "", nfcCodesText: "", lat: "", lng: "" }])
  }

  const removeCheckpoint = (index: number) => {
    setCheckpoints((prev) => prev.filter((_, i) => i !== index))
  }

  const updateCheckpoint = (index: number, field: keyof CheckpointDraft, value: string) => {
    setCheckpoints((prev) => prev.map((cp, i) => (i === index ? { ...cp, [field]: value } : cp)))
  }

  const createRoundId = () => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID()
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }

  const handleSave = async () => {
    if (!user) {
      toast({ title: "Sesion requerida", description: "Inicie sesion para crear una ronda.", variant: "destructive" })
      return
    }

    const cleanName = name.trim()
    const cleanPost = (isPostValidForOperation ? post : "").trim()
    const cleanFrequency = frequency.trim()

    if (!cleanName || !cleanPost || !cleanFrequency) {
      toast({ title: "Campos requeridos", description: "Nombre de ronda, puesto y frecuencia son obligatorios.", variant: "destructive" })
      return
    }

    const validCheckpoints = checkpoints
      .map((cp) => ({
        name: cp.name.trim(),
        qrCodes: cp.qrCodesText.split(",").map((x) => x.trim()).filter(Boolean),
        nfcCodes: cp.nfcCodesText.split(",").map((x) => x.trim()).filter(Boolean),
        lat: Number(cp.lat),
        lng: Number(cp.lng),
      }))
      .filter((cp) => cp.name)
    const invalidGeo = validCheckpoints.find(
      (cp) => {
        const hasLat = Number.isFinite(cp.lat)
        const hasLng = Number.isFinite(cp.lng)
        if (!hasLat && !hasLng) return false
        if (!hasLat || !hasLng) return true
        return Math.abs(cp.lat) > 90 || Math.abs(cp.lng) > 180 || (cp.lat === 0 && cp.lng === 0)
      }
    )
    if (invalidGeo) {
      toast({ title: "Coordenadas invalidas", description: "Si usa GPS en un checkpoint, complete latitud y longitud validas (no 0,0).", variant: "destructive" })
      return
    }


    if (!validCheckpoints.length) {
      toast({ title: "Checkpoint requerido", description: "Agregue al menos un checkpoint con nombre.", variant: "destructive" })
      return
    }

    setSaving(true)
    const roundId = createRoundId()

    const payload = toSnakeCaseKeys({
      id: roundId,
      name: cleanName,
      post: cleanPost,
      status,
      frequency: cleanFrequency,
      operationId: operationName || undefined,
      puestoBase: cleanPost,
      instructions: instructions.trim() || undefined,
      checkpoints: validCheckpoints.map((cp) => ({
        name: cp.name,
        lat: Number.isFinite(cp.lat) ? cp.lat : null,
        lng: Number.isFinite(cp.lng) ? cp.lng : null,
        qrCodes: cp.qrCodes,
        nfcCodes: cp.nfcCodes,
      })),
      createdAt: nowIso(),
    }) as Record<string, unknown>

    try {
      const response = await fetchInternalApi(supabase, "/api/rounds", {
        method: "POST",
        body: JSON.stringify(payload),
      })
      const result = (await response.json().catch(() => null)) as { error?: string } | null

      setSaving(false)

      if (!response.ok) {
        toast({ title: "Error", description: String(result?.error ?? "No se pudo crear la ronda."), variant: "destructive" })
        return
      }

      toast({
        title: "Ronda creada",
        description: "La ronda se guardo correctamente.",
      })
    } catch {
      setSaving(false)
      toast({ title: "Error", description: "No se pudo crear la ronda.", variant: "destructive" })
      return
    }

    router.push(`/rounds?roundId=${encodeURIComponent(roundId)}`)
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 sm:p-6 md:p-10 max-w-5xl mx-auto space-y-6 animate-in fade-in duration-300">
      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm md:text-base font-black uppercase tracking-wider text-white">Nueva ronda</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Nombre de ronda</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: RONDA NOCTURNA NORTE" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
              <Input value={post} onChange={(e) => setPost(e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: ACCESO PRINCIPAL" />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Frecuencia</Label>
              <Input
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="bg-black/30 border-white/10"
                placeholder="Ej: Cada 45 minutos"
              />
              <p className="text-[10px] uppercase text-white/45">Use minutos en el texto para que la programación operativa la interprete bien.</p>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Activa">Activa</SelectItem>
                  <SelectItem value="Inactiva">Inactiva</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Operacion (opcional)</Label>
              <Select value={operationName} onValueChange={setOperationName}>
                <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccionar operacion" /></SelectTrigger>
                <SelectContent>
                  {operationOptions.map((op) => (
                    <SelectItem key={op} value={op}>{op}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {operationName && postOptions.length > 0 ? (
              <div className="space-y-1 md:col-span-2">
                <Label className="text-[10px] uppercase font-black text-white/70">Puesto/Lugar de la operacion</Label>
                <Select value={isPostValidForOperation ? post : ""} onValueChange={setPost}>
                  <SelectTrigger className="bg-black/30 border-white/10"><SelectValue placeholder="Seleccionar puesto/lugar" /></SelectTrigger>
                  <SelectContent>
                    {postOptions.map((p) => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-black text-white/70">Instrucciones (opcional)</Label>
            <Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} className="bg-black/30 border-white/10 min-h-[80px]" />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-[10px] uppercase font-black text-white/70">Checkpoints</Label>
              <Button type="button" onClick={addCheckpoint} variant="outline" className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase gap-1">
                <Plus className="w-3.5 h-3.5" /> Agregar
              </Button>
            </div>

            {isNfcScanning ? (
              <p className="text-[10px] uppercase font-black text-primary">NFC activo: acerque etiqueta para capturar ID.</p>
            ) : null}

            {nfcSupported && isStandalonePwa ? (
              <p className="text-[10px] uppercase font-black text-amber-300">Para leer, escribir o limpiar NFC en celular use Chrome normal. En modo app instalada puede fallar Web NFC.</p>
            ) : null}

            <div className="space-y-2">
              {checkpoints.map((cp, index) => (
                <div key={`cp-${index}`} className="rounded border border-white/10 bg-black/20 p-3 grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr_140px_140px_auto] gap-2 items-end">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">Nombre checkpoint</Label>
                    <Input value={cp.name} onChange={(e) => updateCheckpoint(index, "name", e.target.value)} className="bg-black/30 border-white/10" placeholder="Ej: PORTON NORTE" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] uppercase font-black text-white/60">QRs (coma)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                        onClick={() => openQrScannerForCheckpoint(index)}
                      >
                        <Camera className="w-3 h-3 mr-1" /> Escanear
                      </Button>
                    </div>
                    <Input value={cp.qrCodesText} onChange={(e) => updateCheckpoint(index, "qrCodesText", e.target.value)} className="bg-black/30 border-white/10" placeholder="QR001, QR002" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] uppercase font-black text-white/60">NFC IDs (coma)</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                        onClick={() => void startNfcScan(index)}
                      >
                        NFC
                      </Button>
                    </div>
                    <Input value={cp.nfcCodesText} onChange={(e) => updateCheckpoint(index, "nfcCodesText", e.target.value)} className="bg-black/30 border-white/10" placeholder="NFC001, 04AABBCCDD" />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <Label className="text-[10px] uppercase font-black text-white/60">Latitud opcional</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-6 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                        onClick={() => void fillCheckpointCoordinates(index)}
                        disabled={geoLoadingIndex === index}
                      >
                        {geoLoadingIndex === index ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <LocateFixed className="w-3 h-3 mr-1" />}
                        GPS
                      </Button>
                    </div>
                    <Input value={cp.lat} onChange={(e) => updateCheckpoint(index, "lat", e.target.value)} className="bg-black/30 border-white/10" placeholder="9.93218" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase font-black text-white/60">Longitud opcional</Label>
                    <Input value={cp.lng} onChange={(e) => updateCheckpoint(index, "lng", e.target.value)} className="bg-black/30 border-white/10" placeholder="-84.07895" />
                  </div>
                  <Button
                    type="button"
                    onClick={() => removeCheckpoint(index)}
                    variant="ghost"
                    disabled={checkpoints.length <= 1}
                    className="h-10 text-white/50 hover:text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                  <div className="md:col-span-6 flex flex-wrap gap-2 pt-1">
                    <p className="w-full text-[10px] text-white/50 uppercase">En propiedades pequenas puede dejar GPS vacio y diferenciar puntos solo por NFC.</p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
                      onClick={() => openQrScannerForCheckpoint(index)}
                    >
                      <Camera className="w-3 h-3 mr-1" /> Escanear QR
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
                      onClick={() => void startNfcScan(index)}
                    >
                      NFC
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase"
                      onClick={() => void fillCheckpointCoordinates(index)}
                      disabled={geoLoadingIndex === index}
                    >
                      {geoLoadingIndex === index ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <LocateFixed className="w-3 h-3 mr-1" />}
                      GPS
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {canManageNfcMaintenance ? (
            <Card className="bg-black/20 border-white/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-[11px] font-black uppercase tracking-wider text-white">Mantenimiento NFC L4</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[10px] uppercase text-white/55">Lea una etiqueta, descargue su contenido actual y limpiela sin perder el token base del checkpoint.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" className="h-8 border-white/20 text-white hover:bg-white/10 text-[10px] font-black uppercase gap-2" onClick={() => setNfcMaintenanceOpen(true)}>
                    <ScanLine className="w-3.5 h-3.5" /> Utilidad NFC
                  </Button>
                  {nfcMaintenanceData?.token ? (
                    <p className="text-[10px] uppercase text-white/45">Ultimo token leido: {nfcMaintenanceData.token}</p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ) : null}

          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="ghost" onClick={() => router.push("/rounds")} className="h-11 font-black uppercase">Cancelar</Button>
            <Button onClick={handleSave} disabled={saving} className="h-11 bg-primary text-black font-black uppercase gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Crear ronda
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={qrOpen} onOpenChange={handleQrOpenChange}>
        <DialogContent className="bg-black border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Escanear QR de checkpoint</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">Enfoque el codigo para agregarlo automaticamente.</DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded border border-white/10 bg-black/40 h-60 overflow-hidden relative flex items-center justify-center">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              {!isScanning && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
                  <Camera className="w-6 h-6" />
                  <span className="text-[10px] font-black uppercase">Iniciando camara...</span>
                </div>
              )}
              {isScanning && (
                <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 px-2 py-1 rounded">
                  <ScanLine className="w-3 h-3 text-primary" />
                  <span className="text-[9px] font-black uppercase text-primary">Escaneando</span>
                </div>
              )}
            </div>

            {scanError && <p className="text-[10px] text-red-400 font-bold uppercase">{scanError}</p>}
            {!qrSupported && <p className="text-[10px] text-amber-400 font-bold uppercase">Camara no disponible en este navegador.</p>}
          </div>

          <DialogFooter>
            <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => handleQrOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={nfcMaintenanceOpen} onOpenChange={handleNfcMaintenanceOpenChange}>
        <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Mantenimiento NFC L4</DialogTitle>
            <DialogDescription className="text-[10px] text-white/60 uppercase">Exporte el contenido actual y limpie la metadata sin borrar el token operativo.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded border border-white/10 bg-black/30 p-3 space-y-1">
                <p className="text-[10px] uppercase text-white/45">Token</p>
                <p className="text-sm font-black text-white break-all">{nfcMaintenanceData?.token || "Sin lectura"}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-3 space-y-1">
                <p className="text-[10px] uppercase text-white/45">Serial</p>
                <p className="text-sm font-black text-white break-all">{nfcMaintenanceData?.serialNumber || "No disponible"}</p>
              </div>
              <div className="rounded border border-white/10 bg-black/30 p-3 space-y-1">
                <p className="text-[10px] uppercase text-white/45">Ultima lectura</p>
                <p className="text-sm font-black text-white">{nfcMaintenanceData ? new Date(nfcMaintenanceData.scannedAt).toLocaleString() : "Sin lectura"}</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/60">Contenido actual</Label>
              <Textarea value={nfcMaintenanceText} readOnly className="bg-black/30 border-white/10 min-h-[220px] font-mono text-xs" placeholder="Lea una etiqueta para ver su contenido." />
            </div>

            <p className="text-[10px] uppercase text-white/45">Limpiar escribe solo el token base nuevamente. Eso libera espacio y mantiene el checkpoint funcionando en rondas.</p>
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2" onClick={() => void startNfcMaintenanceScan()} disabled={!nfcSupported || nfcMaintenanceBusy === "scan"}>
              {nfcMaintenanceBusy === "scan" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ScanLine className="w-4 h-4" />}
              Leer etiqueta
            </Button>
            <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2" onClick={downloadNfcMaintenanceData} disabled={!nfcMaintenanceData}>
              <Download className="w-4 h-4" /> Descargar
            </Button>
            <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase gap-2" onClick={() => void clearNfcMaintenanceTag()} disabled={!nfcMaintenanceData?.token || nfcMaintenanceBusy === "clear"}>
              {nfcMaintenanceBusy === "clear" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Limpiar etiqueta
            </Button>
            <Button type="button" variant="ghost" className="font-black uppercase" onClick={() => handleNfcMaintenanceOpenChange(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
