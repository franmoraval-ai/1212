
"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { 
  CirclePlus,
  Loader2,
  Trash2,
  Navigation,
  Map as MapIcon,
  LayoutList,
  FileSpreadsheet,
  FileDown,
  MapPin,
  X,
  QrCode,
  Camera,
  ScanLine
} from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { QRCodeSVG } from "qrcode.react"
import { useSupabase, useCollection, useUser } from "@/supabase"
import { useToast } from "@/hooks/use-toast"
import { TacticalMap } from "@/components/ui/tactical-map"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog"
import { runMutationWithOffline } from "@/lib/offline-mutations"

export default function MaestroDeRondasPage() {
  const { supabase, user } = useSupabase()
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'list' | 'map'>('list')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [qrScannerOpen, setQrScannerOpen] = useState(false)
  const [scanCheckpointIndex, setScanCheckpointIndex] = useState<number | null>(null)
  const [manualQrValue, setManualQrValue] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [qrSupported] = useState(() => typeof window !== "undefined" && "BarcodeDetector" in window)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const [formData, setFormData] = useState({
    name: "",
    post: "",
    status: "Activa",
    frequency: "Cada 30 minutos",
    lng: -84.0907,
    lat: 9.9281,
    checkpoints: [] as { name: string; lat: number; lng: number; qrCodes?: string[] }[]
  })

  const { data: rounds, isLoading: loading } = useCollection(user ? "rounds" : null, { orderBy: "name", orderDesc: false })
  const { data: operationCatalog } = useCollection<{ operationName?: string; clientName?: string; isActive?: boolean }>(
    user ? "operation_catalog" : null,
    { orderBy: "operation_name", orderDesc: false }
  )

  const activeCatalog = useMemo(
    () =>
      (operationCatalog ?? []).filter((item) => item.isActive !== false).map((item) => ({
        operationName: String(item.operationName ?? "").trim(),
        clientName: String(item.clientName ?? "").trim(),
      })),
    [operationCatalog]
  )

  const operationOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((item) => item.operationName))).filter(Boolean),
    [activeCatalog]
  )

  const clientOptions = useMemo(
    () => Array.from(new Set(activeCatalog.map((item) => item.clientName))).filter(Boolean),
    [activeCatalog]
  )

  const appendQrToCheckpoint = useCallback((checkpointIndex: number, qrValue: string) => {
    const clean = qrValue.trim()
    if (!clean) return

    setFormData((prev) => ({
      ...prev,
      checkpoints: prev.checkpoints.map((cp, idx) => {
        if (idx !== checkpointIndex) return cp
        const current = cp.qrCodes ?? []
        if (current.includes(clean)) return cp
        return { ...cp, qrCodes: [...current, clean] }
      }),
    }))
  }, [])

  const stopScanner = useCallback(() => {
    if (scanTimerRef.current != null) {
      window.clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    setIsScanning(false)
  }, [])

  const closeScanner = useCallback(() => {
    stopScanner()
    setQrScannerOpen(false)
    setScanCheckpointIndex(null)
    setManualQrValue("")
    setScanError(null)
  }, [stopScanner])

  const startScanner = useCallback(async () => {
    setScanError(null)

    const DetectorCtor = (window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => {
        detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
      }
    }).BarcodeDetector

    if (!DetectorCtor) {
      setScanError("Lector QR no soportado en este navegador. Use ingreso manual.")
      return
    }

    if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setScanError("No hay acceso a camara en este navegador.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const detector = new DetectorCtor({ formats: ["qr_code"] })
      setIsScanning(true)

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2 || scanCheckpointIndex == null) return
        try {
          const codes = await detector.detect(videoRef.current)
          const raw = codes?.[0]?.rawValue
          if (!raw) return
          appendQrToCheckpoint(scanCheckpointIndex, raw)
          toast({ title: "QR agregado", description: "Codigo incorporado al punto de control." })
          closeScanner()
        } catch {
          // Ignora errores transitorios por frame durante la lectura.
        }
      }, 450)
    } catch {
      setScanError("No se pudo iniciar la camara. Revise permisos.")
      stopScanner()
    }
  }, [appendQrToCheckpoint, closeScanner, scanCheckpointIndex, stopScanner, toast])

  useEffect(() => {
    if (!qrScannerOpen) return
    startScanner()
    return () => stopScanner()
  }, [qrScannerOpen, scanCheckpointIndex, startScanner, stopScanner])

  const handleAddRound = async () => {
    if (!formData.name || !formData.post) {
      toast({
        title: "Campos requeridos",
        description: "Seleccione operación y puesto antes de crear la ronda.",
        variant: "destructive",
      })
      return
    }
    const result = await runMutationWithOffline(supabase, {
      table: "rounds",
      action: "insert",
      payload: {
      name: formData.name,
      post: formData.post,
      status: formData.status,
      frequency: formData.frequency,
      lng: formData.lng,
      lat: formData.lat,
      checkpoints: formData.checkpoints
      },
    })
    if (!result.ok) {
      toast({ title: "Error", description: result.error, variant: "destructive" })
      return
    }
    toast({
      title: result.queued ? "Ronda en cola" : "Ronda Creada",
      description: result.queued
        ? "Sin senal: se sincronizara automaticamente al reconectar."
        : `La ronda ${formData.name} ha sido configurada.`,
    })
    setIsOpen(false)
    setFormData({ name: "", post: "", status: "Activa", frequency: "Cada 30 minutos", lng: -84.0907, lat: 9.9281, checkpoints: [] })
  }

  const handleDelete = async (id: string) => {
    setIsDeleting(true)
    try {
      const result = await runMutationWithOffline(supabase, { table: "rounds", action: "delete", match: { id } })
      if (!result.ok) throw new Error(result.error)
      toast({
        title: result.queued ? "Eliminacion en cola" : "Eliminado",
        description: result.queued ? "Se eliminara al reconectar." : "La ronda se eliminó correctamente.",
      })
    } catch {
      toast({ title: "Error", description: "No se pudo eliminar el registro.", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const roundMarkers = useMemo(() => {
    const main: { lng: number; lat: number; title: string; color: string }[] = rounds?.map(r => ({
      lng: Number(r.lng ?? -84.0907),
      lat: Number(r.lat ?? 9.9281),
      title: String(r.name),
      color: r.status === 'Activa' ? '#22c55e' : '#6b7280'
    })) ?? []
    const fromCheckpoints: { lng: number; lat: number; title: string; color: string }[] = []
    rounds?.forEach(r => {
      (r.checkpoints as { name: string; lat: number; lng: number; qrCodes?: string[] }[] | undefined)?.forEach((cp, i) => {
        fromCheckpoints.push({
          lng: cp.lng ?? -84.09,
          lat: cp.lat ?? 9.92,
          title: `${r.name}: ${cp.name || `Punto ${i + 1}`}`,
          color: '#3b82f6'
        })
      })
    })
    return [...main, ...fromCheckpoints]
  }, [rounds])

  const handleExportExcel = async () => {
    const rows = (rounds || []).map((r) => ({ nombre: r.name || "—", puesto: r.post || "—", estado: r.status || "—", frecuencia: r.frequency || "—" }))
    const result = await exportToExcel(rows, "Rondas", [
      { header: "NOMBRE", key: "nombre", width: 25 },
      { header: "PUESTO", key: "puesto", width: 25 },
      { header: "ESTADO", key: "estado", width: 12 },
      { header: "FRECUENCIA", key: "frecuencia", width: 22 },
    ], "HO_RONDAS")
    if (result.ok) toast({ title: "Excel descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportPdf = () => {
    const rows = (rounds || []).map((r) => [String(r.name || "—").slice(0, 25), String(r.post || "—").slice(0, 22), String(r.status || "—"), String(r.frequency || "—").slice(0, 20)]) as (string | number)[][]
    const result = exportToPdf("RONDAS", ["NOMBRE", "PUESTO", "ESTADO", "FRECUENCIA"], rows, "HO_RONDAS")
    if (result.ok) toast({ title: "PDF descargado", description: "Archivo generado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  return (
    <div className="p-6 md:p-10 space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <ConfirmDeleteDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title="¿Eliminar ronda?"
        description="Se borrará esta ronda del maestro. Esta acción no se puede deshacer."
        onConfirm={async () => { if (deleteId) await handleDelete(deleteId) }}
        isLoading={isDeleting}
      />
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-4xl font-black tracking-tighter uppercase text-white italic">
            Gestión de Rondas
          </h1>
          <p className="text-muted-foreground text-sm font-medium tracking-tight opacity-70">
            Control maestro de patrullajes y vigilancia activa.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 md:gap-3">
          <Button variant="outline" size="sm" onClick={handleExportExcel} className="border-white/20 text-white hover:bg-white/10 h-9 gap-2 text-[10px]">
            <FileSpreadsheet className="w-3 h-3" /> EXCEL
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} className="border-white/20 text-white hover:bg-white/10 h-9 gap-2 text-[10px]">
            <FileDown className="w-3 h-3" /> PDF
          </Button>
          <div className="bg-white/5 p-1 rounded-md border border-white/10 flex">
            <Button 
              variant={viewMode === 'list' ? 'secondary' : 'ghost'} 
              size="sm" 
              onClick={() => setViewMode('list')}
              className="h-8 text-[10px] font-black uppercase"
            >
              <LayoutList className="w-3 h-3 mr-1" /> Lista
            </Button>
            <Button 
              variant={viewMode === 'map' ? 'secondary' : 'ghost'} 
              size="sm" 
              onClick={() => setViewMode('map')}
              className="h-8 text-[10px] font-black uppercase"
            >
              <MapIcon className="w-3 h-3 mr-1" /> Mapa
            </Button>
          </div>

          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90 text-black font-black uppercase text-xs h-10 px-6 gap-2 rounded-md shadow-[0_0_20px_rgba(250,204,21,0.25)] border-none">
                <CirclePlus className="w-4 h-4 stroke-[3px]" />
                Nueva Ronda
              </Button>
            </DialogTrigger>
            <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-black uppercase italic tracking-tighter">Configurar Patrullaje</DialogTitle>
                <DialogDescription className="text-muted-foreground text-[10px] uppercase">Defina los parámetros y ubicación para la ronda operativa.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Nombre de la Ronda</Label>
                    <Select
                      value={formData.name}
                      onValueChange={(value) => {
                        const matched = activeCatalog.find((item) => item.operationName === value)
                        setFormData({ ...formData, name: value, post: matched?.clientName || formData.post })
                      }}
                    >
                      <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue placeholder="Seleccione operación" /></SelectTrigger>
                      <SelectContent>
                        {operationOptions.map((op) => (
                          <SelectItem key={op} value={op}>{op}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {operationOptions.length === 0 && (
                      <p className="text-[10px] uppercase text-amber-400 font-bold">Sin operaciones activas en catálogo.</p>
                    )}
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Puesto / Zona</Label>
                    <Select value={formData.post} onValueChange={(value) => setFormData({ ...formData, post: value })}>
                      <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue placeholder="Seleccione cliente/puesto" /></SelectTrigger>
                      <SelectContent>
                        {clientOptions.map((client) => (
                          <SelectItem key={client} value={client}>{client}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Frecuencia</Label>
                    <Input value={formData.frequency} onChange={e => setFormData({...formData, frequency: e.target.value})} placeholder="Ej: Cada 1 hora" className="bg-white/5 border-white/10 text-white" />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-[10px] uppercase font-black text-primary">Estado Inicial</Label>
                    <Select onValueChange={v => setFormData({...formData, status: v})} defaultValue="Activa">
                      <SelectTrigger className="bg-white/5 border-white/10 text-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Activa">Activa</SelectItem>
                        <SelectItem value="Inactiva">Inactiva</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Ubicación en el Mapa</Label>
                  <div className="h-[300px] w-full relative">
                    <TacticalMap 
                      center={[formData.lng, formData.lat]}
                      zoom={14}
                      onLocationSelect={(lng, lat) => setFormData({...formData, lng, lat})}
                      markers={[
                        { lng: formData.lng, lat: formData.lat, color: '#F59E0B', title: 'Inicio' },
                        ...formData.checkpoints.map((cp, i) => ({ lng: cp.lng, lat: cp.lat, color: '#3b82f6', title: cp.name || `Punto ${i + 1}` }))
                      ]}
                      className="w-full h-full"
                    />
                    <div className="absolute top-2 left-2 bg-black/80 px-2 py-1 rounded text-[8px] font-bold text-white z-10">
                      CLIC PARA FIJAR PUNTO DE INICIO
                    </div>
                  </div>
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[10px] uppercase font-black text-primary flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> Puntos de control
                      </Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-[9px] h-7 border-white/20"
                        onClick={() => setFormData({
                          ...formData,
                          checkpoints: [...formData.checkpoints, { name: `Punto ${formData.checkpoints.length + 1}`, lat: formData.lat, lng: formData.lng, qrCodes: [] }]
                        })}
                      >
                        <CirclePlus className="w-3 h-3 mr-1" /> Añadir
                      </Button>
                    </div>
                    {formData.checkpoints.length > 0 && (
                      <ul className="space-y-1 max-h-24 overflow-y-auto">
                        {formData.checkpoints.map((cp, i) => (
                          <li key={i} className="grid grid-cols-1 gap-1 text-[10px] bg-white/5 rounded px-2 py-2">
                            <div className="grid grid-cols-[1fr_70px_70px_auto] gap-1 items-center">
                              <Input
                                value={cp.name}
                                onChange={e => setFormData({
                                  ...formData,
                                  checkpoints: formData.checkpoints.map((c, j) => j === i ? { ...c, name: e.target.value } : c)
                                })}
                                className="h-7 bg-black/30 border-white/10"
                                placeholder="Nombre"
                              />
                              <Input type="number" step="any" value={cp.lat} onChange={e => setFormData({ ...formData, checkpoints: formData.checkpoints.map((c, j) => j === i ? { ...c, lat: parseFloat(e.target.value) || 0 } : c) })} className="h-7 bg-black/30 border-white/10 font-mono text-[9px]" placeholder="Lat" />
                              <Input type="number" step="any" value={cp.lng} onChange={e => setFormData({ ...formData, checkpoints: formData.checkpoints.map((c, j) => j === i ? { ...c, lng: parseFloat(e.target.value) || 0 } : c) })} className="h-7 bg-black/30 border-white/10 font-mono text-[9px]" placeholder="Lng" />
                              <Button type="button" variant="ghost" size="icon" className="h-6 w-6 text-destructive shrink-0" onClick={() => setFormData({ ...formData, checkpoints: formData.checkpoints.filter((_, j) => j !== i) })}>
                                <X className="w-3 h-3" />
                              </Button>
                            </div>
                            <Input
                              value={(cp.qrCodes ?? []).join(", ")}
                              onChange={e => setFormData({
                                ...formData,
                                checkpoints: formData.checkpoints.map((c, j) => j === i ? {
                                  ...c,
                                  qrCodes: e.target.value
                                    .split(",")
                                    .map((v) => v.trim())
                                    .filter(Boolean)
                                } : c)
                              })}
                              className="h-7 bg-black/30 border-white/10 text-[9px]"
                              placeholder="Codigos QR (separados por coma)"
                            />
                            <div className="flex items-center justify-between">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[9px] border-white/20"
                                onClick={() => {
                                  setScanCheckpointIndex(i)
                                  setQrScannerOpen(true)
                                }}
                              >
                                <QrCode className="w-3 h-3 mr-1" /> Escanear QR
                              </Button>
                              <span className="text-[9px] text-white/50">
                                {(cp.qrCodes ?? []).length} codigos
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={handleAddRound} className="w-full bg-primary text-black font-black uppercase">ACTIVAR RONDA</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={qrScannerOpen} onOpenChange={(open) => { if (!open) closeScanner() }}>
            <DialogContent className="bg-black border-white/10 text-white max-w-md">
              <DialogHeader>
                <DialogTitle className="font-black uppercase italic tracking-tighter">Escanear Codigo QR</DialogTitle>
                <DialogDescription className="text-muted-foreground text-[10px] uppercase">
                  Punto de control #{(scanCheckpointIndex ?? 0) + 1}
                </DialogDescription>
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
                {!qrSupported && <p className="text-[10px] text-amber-400 font-bold uppercase">Navegador sin soporte QR por camara.</p>}

                <div className="space-y-1">
                  <Label className="text-[10px] uppercase font-black text-white/70">Ingreso manual</Label>
                  <Input
                    value={manualQrValue}
                    onChange={(e) => setManualQrValue(e.target.value)}
                    className="bg-black/30 border-white/10"
                    placeholder="Pegue aqui el contenido del QR"
                  />
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
                  onClick={() => {
                    if (scanCheckpointIndex == null || !manualQrValue.trim()) return
                    appendQrToCheckpoint(scanCheckpointIndex, manualQrValue)
                    toast({ title: "QR agregado", description: "Codigo incorporado al punto de control." })
                    closeScanner()
                  }}
                >
                  Agregar manual
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card className="bg-[#0c0c0c]/60 border-white/5 shadow-2xl overflow-hidden backdrop-blur-sm">
        {viewMode === 'list' ? (
          <>
            <CardHeader className="pb-6 pt-10 px-10">
              <CardTitle className="text-2xl font-black text-white uppercase tracking-tight">
                Todas las Rondas
              </CardTitle>
              <CardDescription className="text-muted-foreground text-xs font-bold opacity-60 tracking-tight uppercase">
                Configuración de patrullajes maestros.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-10 pb-16">
              <Table>
                <TableHeader className="border-none">
                  <TableRow className="hover:bg-transparent border-none">
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6 w-14">QR</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6">NOMBRE</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6">PUESTO ASIGNADO</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6 text-center">QRs</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6">FRECUENCIA</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6">ESTADO</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6 text-center">EJECUCIÓN</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground/60 py-6 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow className="border-none">
                      <TableCell colSpan={8} className="h-64 text-center">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
                      </TableCell>
                    </TableRow>
                  ) : rounds && rounds.length > 0 ? (
                    rounds.map((round) => (
                      <TableRow key={round.id} className="border-white/5 hover:bg-white/[0.02]">
                        <TableCell className="py-2">
                          <div className="bg-white p-1 rounded inline-block" title={`QR Ronda: ${round.name}`}>
                            <QRCodeSVG value={JSON.stringify({ id: round.id, name: round.name, post: round.post })} size={44} level="M" />
                          </div>
                        </TableCell>
                        <TableCell className="text-xs font-black text-white uppercase italic tracking-widest">
                          <div className="flex items-center gap-3">
                            <Navigation className="w-4 h-4 text-primary" />
                            {String(round.name)}
                          </div>
                        </TableCell>
                        <TableCell className="text-[10px] font-bold text-muted-foreground uppercase">{String(round.post)}</TableCell>
                        <TableCell className="text-center">
                          <span className="text-[10px] font-black text-primary">
                            {((round.checkpoints as { qrCodes?: string[] }[] | undefined) ?? []).reduce((acc, cp) => acc + ((cp.qrCodes ?? []).length), 0)}
                          </span>
                        </TableCell>
                        <TableCell className="text-[10px] font-mono text-primary">{String(round.frequency)}</TableCell>
                        <TableCell>
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded ${
                            round.status === 'Activa' ? 'bg-green-500/20 text-green-500' : 'bg-white/10 text-white/40'
                          }`}>
                            {String(round.status)}
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            asChild
                            size="sm"
                            className="h-8 bg-primary text-black font-black uppercase text-[9px]"
                          >
                            <Link
                              href={`/supervision?operation=${encodeURIComponent(String(round.name || ""))}&post=${encodeURIComponent(String(round.post || ""))}&officer=${encodeURIComponent(String(user?.firstName || user?.email || ""))}`}
                            >
                              Ejecutar
                            </Link>
                          </Button>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-destructive/30 hover:text-destructive"
                            onClick={() => setDeleteId(round.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow className="border-none hover:bg-transparent">
                      <TableCell colSpan={8} className="h-64 text-center">
                        <div className="flex flex-col items-center justify-center space-y-4">
                          <span className="text-xs font-black uppercase tracking-widest text-muted-foreground/40 italic">
                            No hay rondas maestras registradas.
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </>
        ) : (
          <div className="h-[600px] w-full relative">
            <TacticalMap 
              markers={roundMarkers}
              center={[-84.0907, 9.9281]}
              zoom={10}
              className="w-full h-full"
            />
            <div className="absolute bottom-6 right-6 bg-black/90 p-4 rounded border border-white/10 backdrop-blur-md z-10 max-w-xs">
              <h3 className="text-xs font-black text-white uppercase italic mb-2">Resumen Táctico</h3>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Rondas Activas</span>
                <span className="text-[10px] font-black text-green-500">{rounds?.filter(r => r.status === 'Activa').length || 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Total Puestos</span>
                <span className="text-[10px] font-black text-primary">{rounds?.length || 0}</span>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
