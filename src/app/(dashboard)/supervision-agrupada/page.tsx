"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { useCollection, useUser } from "@/supabase"
import { exportToExcel, exportToPdf } from "@/lib/export-utils"
import { useToast } from "@/hooks/use-toast"
import { FileSpreadsheet, FileDown, Search, ListChecks, Loader2, QrCode, Camera, ScanLine } from "lucide-react"

type SupervisionRow = {
  id: string
  createdAt?: { toDate?: () => Date }
  operationName?: string
  officerName?: string
  reviewPost?: string
  supervisorId?: string
  status?: string
}

type GroupedRow = {
  date: string
  puesto: string
  supervisor: string
  usuarios: string[]
  total: number
  cumplim: number
  novedad: number
}

const UNKNOWN = "NO DEFINIDO"

export default function SupervisionAgrupadaPage() {
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()

  const [search, setSearch] = useState("")
  const [puestoFilter, setPuestoFilter] = useState("TODOS")
  const [supervisorFilter, setSupervisorFilter] = useState("TODOS")
  const [usuarioFilter, setUsuarioFilter] = useState("TODOS")
  const [fromDate, setFromDate] = useState("")
  const [toDate, setToDate] = useState("")
  const [qrOpen, setQrOpen] = useState(false)
  const [qrInput, setQrInput] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [qrSupported, setQrSupported] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)

  const { data: reportesData, isLoading } = useCollection<SupervisionRow>(
    user ? "supervisions" : null,
    { orderBy: "created_at", orderDesc: true }
  )

  const normalized = useMemo(() => {
    return (reportesData ?? []).map((r) => {
      const dt = r.createdAt?.toDate?.()
      const day = dt instanceof Date && !Number.isNaN(dt.getTime())
        ? dt.toISOString().slice(0, 10)
        : "1970-01-01"

      return {
        id: r.id,
        date: day,
        puesto: String(r.reviewPost ?? "").trim() || UNKNOWN,
        supervisor: String(r.supervisorId ?? "").trim() || UNKNOWN,
        usuario: String(r.officerName ?? "").trim() || UNKNOWN,
        operacion: String(r.operationName ?? "").trim() || UNKNOWN,
        status: String(r.status ?? "").trim().toUpperCase(),
      }
    })
  }, [reportesData])

  const puestos = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.puesto))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )
  const supervisores = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.supervisor))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )
  const usuarios = useMemo(
    () => Array.from(new Set(normalized.map((r) => r.usuario))).sort((a, b) => a.localeCompare(b)),
    [normalized]
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return normalized.filter((r) => {
      if (puestoFilter !== "TODOS" && r.puesto !== puestoFilter) return false
      if (supervisorFilter !== "TODOS" && r.supervisor !== supervisorFilter) return false
      if (usuarioFilter !== "TODOS" && r.usuario !== usuarioFilter) return false
      if (fromDate && r.date < fromDate) return false
      if (toDate && r.date > toDate) return false

      if (!q) return true
      return (
        r.puesto.toLowerCase().includes(q) ||
        r.supervisor.toLowerCase().includes(q) ||
        r.usuario.toLowerCase().includes(q) ||
        r.operacion.toLowerCase().includes(q)
      )
    })
  }, [normalized, search, puestoFilter, supervisorFilter, usuarioFilter, fromDate, toDate])

  const grouped = useMemo(() => {
    const map = new Map<string, GroupedRow>()

    for (const row of filtered) {
      const key = `${row.date}|${row.puesto}|${row.supervisor}`
      const current = map.get(key)

      if (!current) {
        map.set(key, {
          date: row.date,
          puesto: row.puesto,
          supervisor: row.supervisor,
          usuarios: [row.usuario],
          total: 1,
          cumplim: row.status.includes("CUMPLIM") ? 1 : 0,
          novedad: row.status.includes("NOVEDAD") ? 1 : 0,
        })
      } else {
        current.total += 1
        if (!current.usuarios.includes(row.usuario)) current.usuarios.push(row.usuario)
        if (row.status.includes("CUMPLIM")) current.cumplim += 1
        if (row.status.includes("NOVEDAD")) current.novedad += 1
      }
    }

    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date))
  }, [filtered])

  const totalItems = filtered.length
  const totalGrupos = grouped.length

  const stopScanner = () => {
    if (scanTimerRef.current != null) {
      window.clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsScanning(false)
  }

  const applyQrValue = (value: string) => {
    const clean = value.trim()
    if (!clean) return

    try {
      const parsed = JSON.parse(clean) as { id?: string; name?: string; post?: string }
      const composed = [parsed.name, parsed.post, parsed.id].filter(Boolean).join(" ").trim()
      setSearch(composed || clean)
      setQrInput(clean)
      toast({ title: "QR detectado", description: "Filtro aplicado al buscador." })
    } catch {
      setSearch(clean)
      setQrInput(clean)
      toast({ title: "QR detectado", description: "Filtro aplicado al buscador." })
    }
  }

  const startScanner = async () => {
    setScanError(null)

    if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setScanError("Este navegador no permite acceso a la camara.")
      return
    }

    const DetectorCtor = (window as unknown as { BarcodeDetector?: new (opts?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector
    if (!DetectorCtor) {
      setScanError("Lector QR no soportado en este navegador. Use entrada manual.")
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      const detector = new DetectorCtor({ formats: ["qr_code"] })
      setIsScanning(true)

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) return
        try {
          const codes = await detector.detect(videoRef.current)
          const rawValue = codes?.[0]?.rawValue
          if (rawValue) {
            applyQrValue(rawValue)
            setQrOpen(false)
          }
        } catch {
          // Ignorar errores intermitentes de frame durante la captura.
        }
      }, 500)
    } catch {
      setScanError("No se pudo iniciar la camara. Verifique permisos.")
      stopScanner()
    }
  }

  useEffect(() => {
    const supported = typeof window !== "undefined" && "BarcodeDetector" in window
    setQrSupported(supported)
  }, [])

  useEffect(() => {
    if (!qrOpen) {
      stopScanner()
      return
    }

    startScanner()
    return () => stopScanner()
  }, [qrOpen])

  const handleExportGroupedExcel = async () => {
    const rows = grouped.map((g) => ({
      fecha: g.date,
      puesto: g.puesto,
      supervisor: g.supervisor,
      usuarios: g.usuarios.join(", "),
      total: g.total,
      cumplimiento: g.cumplim,
      novedad: g.novedad,
    }))

    const result = await exportToExcel(rows, "Supervisión Agrupada", [
      { header: "FECHA", key: "fecha", width: 12 },
      { header: "PUESTO", key: "puesto", width: 24 },
      { header: "SUPERVISOR", key: "supervisor", width: 22 },
      { header: "USUARIOS", key: "usuarios", width: 30 },
      { header: "TOTAL", key: "total", width: 10 },
      { header: "CUMPLIM", key: "cumplimiento", width: 10 },
      { header: "NOVEDAD", key: "novedad", width: 10 },
    ], "HO_SUPERVISION_AGRUPADA")

    if (result.ok) toast({ title: "Excel descargado", description: "Agrupación exportada correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  const handleExportDetailedPdf = () => {
    const rows = filtered.map((r) => [
      r.date,
      r.puesto.slice(0, 20),
      r.supervisor.slice(0, 18),
      r.usuario.slice(0, 18),
      r.operacion.slice(0, 20),
      r.status || "—",
    ])

    const result = exportToPdf(
      "SUPERVISION AGRUPADA",
      ["FECHA", "PUESTO", "SUPERVISOR", "USUARIO", "OPERACION", "ESTADO"],
      rows,
      "HO_SUPERVISION_AGRUPADA"
    )

    if (result.ok) toast({ title: "PDF descargado", description: "Detalle exportado correctamente." })
    else toast({ title: "Error al exportar", description: result.error, variant: "destructive" })
  }

  if (isUserLoading) return null

  return (
    <div className="p-4 md:p-10 space-y-6 md:space-y-10 animate-in fade-in duration-500 relative min-h-screen max-w-7xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">SUPERVISION AGRUPADA</h1>
        <p className="text-muted-foreground text-xs md:text-sm font-medium tracking-tight opacity-70">
          Acceso rapido por puesto, supervisor, fecha y usuario para descarga inmediata.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase font-black text-muted-foreground">Registros filtrados</p>
            <p className="text-3xl font-black text-white mt-1">{totalItems}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5">
            <p className="text-[10px] uppercase font-black text-muted-foreground">Grupos activos</p>
            <p className="text-3xl font-black text-white mt-1">{totalGrupos}</p>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c]/60 border-white/5">
          <CardContent className="p-5 flex items-center gap-2">
            <ListChecks className="w-5 h-5 text-primary" />
            <p className="text-[11px] uppercase font-black text-white/80">Centro de consulta y exportacion</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-[#0c0c0c] border-white/5">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Filtros de acceso rapido</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Busqueda</Label>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2 top-1/2 -translate-y-1/2 text-white/40" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 bg-black/30 border-white/10" placeholder="Puesto, usuario, operacion..." />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
            <Select value={puestoFilter} onValueChange={setPuestoFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {puestos.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Supervisor</Label>
            <Select value={supervisorFilter} onValueChange={setSupervisorFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {supervisores.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Usuario</Label>
            <Select value={usuarioFilter} onValueChange={setUsuarioFilter}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="TODOS">TODOS</SelectItem>
                {usuarios.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Desde</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Hasta</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-black/30 border-white/10" />
          </div>

          <div className="md:col-span-2 lg:col-span-2 flex items-end gap-2">
            <Button onClick={handleExportGroupedExcel} className="bg-primary hover:bg-primary/90 text-black font-black uppercase h-10 gap-2">
              <FileSpreadsheet className="w-4 h-4" /> Excel Agrupado
            </Button>
            <Button onClick={handleExportDetailedPdf} variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase h-10 gap-2">
              <FileDown className="w-4 h-4" /> PDF Detallado
            </Button>
            <Button onClick={() => setQrOpen(true)} variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase h-10 gap-2">
              <QrCode className="w-4 h-4" /> Lector QR
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="bg-[#0c0c0c] border-white/10 text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Lector QR</DialogTitle>
            <DialogDescription className="text-[11px] text-white/60">
              Escanee un codigo para aplicar filtro rapido por puesto, usuario u operacion.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="rounded-md border border-white/10 bg-black/40 overflow-hidden h-64 flex items-center justify-center relative">
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
            {!qrSupported && <p className="text-[10px] text-amber-400 font-bold uppercase">Este navegador no soporta lectura QR por camara.</p>}

            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Entrada manual</Label>
              <Input
                value={qrInput}
                onChange={(e) => setQrInput(e.target.value)}
                placeholder="Pegue el contenido del QR"
                className="bg-black/30 border-white/10"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (qrInput.trim()) {
                  applyQrValue(qrInput)
                  setQrOpen(false)
                }
              }}
              className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
            >
              Aplicar filtro
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="bg-[#0c0c0c] border-white/5 overflow-hidden">
        <CardHeader>
          <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Agrupacion por fecha, puesto y supervisor</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white/[0.03] border-b border-white/5">
                <tr>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Fecha</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Puesto</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Supervisor</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50">Usuarios</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Total</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Cumplim</th>
                  <th className="px-4 py-3 text-[10px] uppercase font-black text-white/50 text-center">Novedad</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                    </td>
                  </tr>
                ) : grouped.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center text-[10px] uppercase font-black text-white/40">Sin resultados para los filtros seleccionados.</td>
                  </tr>
                ) : (
                  grouped.map((g, idx) => (
                    <tr key={`${g.date}-${g.puesto}-${g.supervisor}-${idx}`} className="hover:bg-white/[0.02]">
                      <td className="px-4 py-3 text-[11px] font-mono text-white/80">{g.date}</td>
                      <td className="px-4 py-3 text-[11px] font-black text-white uppercase">{g.puesto}</td>
                      <td className="px-4 py-3 text-[11px] text-white/80">{g.supervisor}</td>
                      <td className="px-4 py-3 text-[11px] text-white/70">{g.usuarios.join(", ")}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-primary">{g.total}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-green-400">{g.cumplim}</td>
                      <td className="px-4 py-3 text-center text-[11px] font-black text-red-400">{g.novedad}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
