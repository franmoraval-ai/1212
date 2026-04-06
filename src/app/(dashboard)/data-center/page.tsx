"use client"

import { useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useDataOpsContext } from "@/hooks/use-data-ops-context"
import { useToast } from "@/hooks/use-toast"
import { fetchInternalApi } from "@/lib/internal-api"
import { hasPermission } from "@/lib/access-control"
import { useSupabase, useUser } from "@/supabase"
import { Archive, DatabaseZap, Download, FileUp, Loader2, RotateCcw, Search } from "lucide-react"

type ExportJobRow = {
  id: string
  entityType?: string
  dataSource?: string
  exportFormat?: string
  status?: string
  rowCount?: number
  fileName?: string
  errorMessage?: string
  createdAt?: { toDate?: () => Date }
  completedAt?: { toDate?: () => Date }
}

type ArchiveRunRow = {
  id: string
  entityType?: string
  cutoffDate?: string
  dryRun?: boolean
  batchSize?: number
  status?: string
  matchedCount?: number
  archivedCount?: number
  deletedCount?: number
  errorMessage?: string
  createdAt?: { toDate?: () => Date }
  completedAt?: { toDate?: () => Date }
}

type ArchivedHistoryRow = {
  id: string
  archivedAt: string
  createdAt: string
  status: string
  summary: string
}

type RestoreRunRow = {
  id: string
  sourceRunId?: string
  entityType?: string
  dryRun?: boolean
  batchSize?: number
  status?: string
  matchedCount?: number
  restoredCount?: number
  removedFromArchiveCount?: number
  errorMessage?: string
  createdAt?: { toDate?: () => Date }
  completedAt?: { toDate?: () => Date }
}

const DATASET_OPTIONS = [
  { value: "supervisions", label: "Supervisiones" },
  { value: "round_reports", label: "Rondas" },
  { value: "incidents", label: "Incidentes" },
  { value: "internal_notes", label: "Novedades Internas" },
  { value: "visitors", label: "Visitantes" },
  { value: "weapons", label: "Armamento" },
] as const

function formatDate(value?: { toDate?: () => Date } | string | null) {
  if (!value) return "-"
  if (typeof value === "string") {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? "-" : parsed.toLocaleString()
  }
  return value.toDate?.()?.toLocaleString?.() ?? "-"
}

function getStatusVariant(status: string) {
  const normalized = status.trim().toLowerCase()
  if (normalized === "completed") return "default" as const
  if (normalized === "processing") return "secondary" as const
  if (normalized === "failed") return "destructive" as const
  return "outline" as const
}

export default function DataCenterPage() {
  const { supabase } = useSupabase()
  const { user, isUserLoading } = useUser()
  const { toast } = useToast()
  const canManageDataOps = (user?.roleLevel ?? 1) >= 4 || hasPermission(user?.customPermissions, "data_ops_manage")

  const [entityType, setEntityType] = useState<(typeof DATASET_OPTIONS)[number]["value"]>("supervisions")
  const [source, setSource] = useState<"live" | "archive">("live")
  const [format, setFormat] = useState<"csv" | "json">("csv")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("")
  const [operation, setOperation] = useState("")
  const [post, setPost] = useState("")
  const [officer, setOfficer] = useState("")
  const [supervisor, setSupervisor] = useState("")
  const [limit, setLimit] = useState("2000")
  const [creatingExport, setCreatingExport] = useState(false)

  const [archiveEntity, setArchiveEntity] = useState<(typeof DATASET_OPTIONS)[number]["value"]>("supervisions")
  const [archiveCutoffDate, setArchiveCutoffDate] = useState("")
  const [archiveBatchSize, setArchiveBatchSize] = useState("500")
  const [archiveDryRun, setArchiveDryRun] = useState(true)
  const [runningArchive, setRunningArchive] = useState(false)
  const [restoringRunId, setRestoringRunId] = useState("")

  const [historyEntity, setHistoryEntity] = useState<(typeof DATASET_OPTIONS)[number]["value"]>("supervisions")
  const [historyDateFrom, setHistoryDateFrom] = useState("")
  const [historyDateTo, setHistoryDateTo] = useState("")
  const [historySearch, setHistorySearch] = useState("")
  const [historyRows, setHistoryRows] = useState<ArchivedHistoryRow[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)

  const { exportJobs, archiveRuns, restoreRuns, reload } = useDataOpsContext(canManageDataOps)

  const completedExports = useMemo(
    () => exportJobs.filter((job) => String(job.status ?? "").toLowerCase() === "completed").length,
    [exportJobs]
  )

  const archiveDeletes = useMemo(
    () => archiveRuns.reduce((total, run) => total + Number(run.deletedCount ?? 0), 0),
    [archiveRuns]
  )

  const restoredRows = useMemo(
    () => restoreRuns.reduce((total, run) => total + Number(run.restoredCount ?? 0), 0),
    [restoreRuns]
  )

  const handleCreateExport = async () => {
    setCreatingExport(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/data-ops/exports", {
        method: "POST",
        body: JSON.stringify({
          entityType,
          source,
          format,
          filters: {
            dateFrom,
            dateTo,
            search,
            status,
            operation,
            post,
            officer,
            supervisor,
            limit,
          },
        }),
      })

      const result = (await response.json()) as { error?: string; rowCount?: number; jobId?: string }
      if (!response.ok) {
        toast({ title: "Error", description: result.error ?? "No se pudo crear la exportacion.", variant: "destructive" })
        return
      }

      toast({
        title: "Exportacion lista",
        description: `Job ${result.jobId ?? ""} completado con ${result.rowCount ?? 0} filas.`,
      })
      void reload(false)
    } catch {
      toast({ title: "Error", description: "No se pudo crear la exportacion.", variant: "destructive" })
    } finally {
      setCreatingExport(false)
    }
  }

  const handleDownload = async (jobId: string, fallbackFileName?: string) => {
    try {
      const response = await fetchInternalApi(supabase, `/api/data-ops/exports/${jobId}/download`, {
        method: "GET",
      })

      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string }
        toast({ title: "Error", description: result.error ?? "No se pudo descargar la exportacion.", variant: "destructive" })
        return
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get("Content-Disposition") ?? ""
      const match = /filename="?([^\"]+)"?/i.exec(contentDisposition)
      const filename = match?.[1] ?? fallbackFileName ?? `data-export-${jobId}.csv`
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
    } catch {
      toast({ title: "Error", description: "No se pudo descargar la exportacion.", variant: "destructive" })
    }
  }

  const handleArchiveRun = async () => {
    if (!archiveCutoffDate) {
      toast({ title: "Fecha requerida", description: "Seleccione la fecha de corte.", variant: "destructive" })
      return
    }

    setRunningArchive(true)
    try {
      const response = await fetchInternalApi(supabase, "/api/data-ops/archive-runs", {
        method: "POST",
        body: JSON.stringify({
          entityType: archiveEntity,
          cutoffDate: archiveCutoffDate,
          batchSize: Number(archiveBatchSize),
          dryRun: archiveDryRun,
        }),
      })
      const result = (await response.json()) as { error?: string; matchedCount?: number; archivedCount?: number; deletedCount?: number; dryRun?: boolean }
      if (!response.ok) {
        toast({ title: "Error", description: result.error ?? "No se pudo ejecutar archivado.", variant: "destructive" })
        return
      }

      toast({
        title: archiveDryRun ? "Simulacion completada" : "Archivado completado",
        description: archiveDryRun
          ? `${result.matchedCount ?? 0} filas encontradas para mover.`
          : `Archivadas ${result.archivedCount ?? 0} y eliminadas ${result.deletedCount ?? 0}.`,
      })
      void reload(false)
    } catch {
      toast({ title: "Error", description: "No se pudo ejecutar archivado.", variant: "destructive" })
    } finally {
      setRunningArchive(false)
    }
  }

  const handleSearchHistory = async () => {
    setLoadingHistory(true)
    try {
      const params = new URLSearchParams({ entityType: historyEntity, limit: "100" })
      if (historyDateFrom) params.set("dateFrom", historyDateFrom)
      if (historyDateTo) params.set("dateTo", historyDateTo)
      if (historySearch.trim()) params.set("search", historySearch.trim())

      const response = await fetchInternalApi(supabase, `/api/data-ops/history?${params.toString()}`)
      const result = (await response.json()) as { error?: string; rows?: ArchivedHistoryRow[] }
      if (!response.ok) {
        toast({ title: "Error", description: result.error ?? "No se pudo consultar historico.", variant: "destructive" })
        return
      }
      setHistoryRows(result.rows ?? [])
    } catch {
      toast({ title: "Error", description: "No se pudo consultar historico.", variant: "destructive" })
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleRestoreRun = async (runId: string) => {
    setRestoringRunId(runId)
    try {
      const response = await fetchInternalApi(supabase, `/api/data-ops/archive-runs/${runId}/restore`, {
        method: "POST",
        body: JSON.stringify({ dryRun: false, batchSize: 500 }),
      })

      const result = (await response.json()) as { error?: string; restoredCount?: number; removedFromArchiveCount?: number }
      if (!response.ok) {
        toast({ title: "Error", description: result.error ?? "No se pudo restaurar el lote.", variant: "destructive" })
        return
      }

      toast({
        title: "Lote restaurado",
        description: `Restauradas ${result.restoredCount ?? 0} filas y retiradas ${result.removedFromArchiveCount ?? 0} del archivo.`,
      })
      void reload(false)
    } catch {
      toast({ title: "Error", description: "No se pudo restaurar el lote.", variant: "destructive" })
    } finally {
      setRestoringRunId("")
    }
  }

  if (isUserLoading) return null

  if (!canManageDataOps) {
    return (
      <div className="p-4 md:p-10 max-w-5xl mx-auto">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardHeader>
            <CardTitle className="text-white uppercase font-black">Centro de Datos restringido</CardTitle>
            <CardDescription>Este modulo requiere perfil de director o permiso de encargado de datos.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-10 space-y-8 max-w-7xl mx-auto animate-in fade-in duration-500">
      <div className="space-y-2">
        <h1 className="text-3xl md:text-4xl font-black tracking-tighter uppercase text-white italic">CENTRO DE DATOS</h1>
        <p className="text-muted-foreground text-[11px] uppercase tracking-[0.2em] font-bold">
          Descargas centralizadas, control de históricos y archivo por lote.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <div className="text-[10px] uppercase font-black tracking-widest text-cyan-300">Exportaciones completadas</div>
            <div className="text-3xl font-black text-white">{completedExports}</div>
            <div className="text-xs text-white/50">Jobs listos para descarga desde servidor.</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <div className="text-[10px] uppercase font-black tracking-widest text-amber-300">Corridas de archivo</div>
            <div className="text-3xl font-black text-white">{archiveRuns.length}</div>
            <div className="text-xs text-white/50">Simulaciones y ejecuciones registradas.</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <div className="text-[10px] uppercase font-black tracking-widest text-emerald-300">Filas retiradas</div>
            <div className="text-3xl font-black text-white">{archiveDeletes}</div>
            <div className="text-xs text-white/50">Datos antiguos removidos del flujo operativo.</div>
          </CardContent>
        </Card>
        <Card className="bg-[#0c0c0c] border-white/5">
          <CardContent className="p-5 space-y-2">
            <div className="text-[10px] uppercase font-black tracking-widest text-fuchsia-300">Filas restauradas</div>
            <div className="text-3xl font-black text-white">{restoredRows}</div>
            <div className="text-xs text-white/50">Lotes devueltos desde archivo a producción.</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="exports" className="space-y-6">
        <TabsList className="bg-white/5 border border-white/5 h-12 w-full sm:w-auto">
          <TabsTrigger value="exports" className="text-[10px] uppercase font-black px-8">Exportaciones</TabsTrigger>
          <TabsTrigger value="archives" className="text-[10px] uppercase font-black px-8">Archivado</TabsTrigger>
        </TabsList>

        <TabsContent value="exports" className="space-y-6">
          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <DatabaseZap className="w-4 h-4 text-primary" />
                Nueva descarga centralizada
              </CardTitle>
              <CardDescription>CSV o JSON desde servidor con filtros comunes para supervisiones, rondas e incidentes.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Dataset</Label>
                <Select value={entityType} onValueChange={(value) => setEntityType(value as typeof entityType)}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATASET_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Origen</Label>
                <Select value={source} onValueChange={(value) => setSource(value as "live" | "archive")}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="live">Datos vivos</SelectItem>
                    <SelectItem value="archive">Archivo historico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Formato</Label>
                <Select value={format} onValueChange={(value) => setFormat(value as "csv" | "json")}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="csv">CSV operativo</SelectItem>
                    <SelectItem value="json">JSON tecnico</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Fecha desde</Label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Fecha hasta</Label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Límite</Label>
                <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="bg-white/5 border-white/10 h-11" placeholder="2000" />
              </div>
              <div className="space-y-2 md:col-span-3">
                <Label className="text-[10px] uppercase font-black text-primary">Búsqueda libre</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/40" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} className="bg-white/5 border-white/10 h-11 pl-10" placeholder="Operacion, puesto, oficial, observacion o titulo" />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Estado</Label>
                <Input value={status} onChange={(e) => setStatus(e.target.value)} className="bg-white/5 border-white/10 h-11" placeholder="CUMPLIM, ABIERTO, COMPLETA..." />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Operación</Label>
                <Input value={operation} onChange={(e) => setOperation(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Puesto</Label>
                <Input value={post} onChange={(e) => setPost(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Oficial</Label>
                <Input value={officer} onChange={(e) => setOfficer(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Supervisor</Label>
                <Input value={supervisor} onChange={(e) => setSupervisor(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="flex items-end">
                <Button onClick={handleCreateExport} className="w-full h-11 bg-primary text-black font-black uppercase" disabled={creatingExport}>
                  {creatingExport ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
                  {creatingExport ? "Procesando" : "Generar exportación"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Historial de jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Dataset</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Origen</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Formato</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Estado</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Filas</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Creado</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50 text-right">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {exportJobs.slice(0, 12).map((job) => (
                    <TableRow key={job.id} className="border-white/5">
                      <TableCell>{String(job.entityType ?? "-")}</TableCell>
                      <TableCell>{String(job.dataSource ?? "-")}</TableCell>
                      <TableCell>{String(job.exportFormat ?? "-")}</TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(String(job.status ?? ""))}>{String(job.status ?? "-")}</Badge>
                      </TableCell>
                      <TableCell>{Number(job.rowCount ?? 0)}</TableCell>
                      <TableCell>{formatDate(job.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {String(job.status ?? "").toLowerCase() === "completed" ? (
                          <Button variant="outline" className="border-white/10" onClick={() => void handleDownload(job.id, job.fileName)}>
                            <Download className="w-4 h-4" /> Descargar
                          </Button>
                        ) : (
                          <span className="text-xs text-white/40">{String(job.errorMessage ?? "-")}</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {exportJobs.length === 0 && (
                    <TableRow className="border-white/5">
                      <TableCell colSpan={7} className="text-center text-white/40 h-24">Aun no hay jobs de exportacion.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="archives" className="space-y-6">
          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white flex items-center gap-2">
                <Archive className="w-4 h-4 text-primary" />
                Corte y archivo de datos viejos
              </CardTitle>
              <CardDescription>Primero simule, luego ejecute el movimiento para retirar datos viejos del flujo operativo. El cron mensual usa esta misma lógica.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Dataset</Label>
                <Select value={archiveEntity} onValueChange={(value) => setArchiveEntity(value as typeof archiveEntity)}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DATASET_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Fecha de corte</Label>
                <Input type="date" value={archiveCutoffDate} onChange={(e) => setArchiveCutoffDate(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Lote máximo</Label>
                <Input value={archiveBatchSize} onChange={(e) => setArchiveBatchSize(e.target.value)} className="bg-white/5 border-white/10 h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-[10px] uppercase font-black text-primary">Modo</Label>
                <Select value={archiveDryRun ? "dry" : "live"} onValueChange={(value) => setArchiveDryRun(value === "dry")}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dry">Simulación</SelectItem>
                    <SelectItem value="live">Ejecutar archivo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="md:col-span-4 flex justify-end">
                <Button onClick={handleArchiveRun} className="h-11 bg-primary text-black font-black uppercase" disabled={runningArchive}>
                  {runningArchive ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  {archiveDryRun ? "Probar corte" : "Mover a archivo"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Histórico archivado</CardTitle>
              <CardDescription>Búsqueda rápida sobre registros ya retirados de la operación viva.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Dataset</Label>
                  <Select value={historyEntity} onValueChange={(value) => setHistoryEntity(value as typeof historyEntity)}>
                    <SelectTrigger className="bg-white/5 border-white/10 h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DATASET_OPTIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Fecha desde</Label>
                  <Input type="date" value={historyDateFrom} onChange={(e) => setHistoryDateFrom(e.target.value)} className="bg-white/5 border-white/10 h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Fecha hasta</Label>
                  <Input type="date" value={historyDateTo} onChange={(e) => setHistoryDateTo(e.target.value)} className="bg-white/5 border-white/10 h-11" />
                </div>
                <div className="space-y-2">
                  <Label className="text-[10px] uppercase font-black text-primary">Búsqueda</Label>
                  <Input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} className="bg-white/5 border-white/10 h-11" placeholder="Operacion, ronda o incidente" />
                </div>
              </div>
              <div className="flex justify-end">
                <Button variant="outline" className="border-white/10" onClick={handleSearchHistory} disabled={loadingHistory}>
                  {loadingHistory ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Buscar en archivo
                </Button>
              </div>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Registro</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Resumen</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Estado</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Fecha origen</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Archivado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.map((row) => (
                    <TableRow key={`${row.id}-${row.archivedAt}`} className="border-white/5">
                      <TableCell className="font-mono text-xs">{row.id}</TableCell>
                      <TableCell>{row.summary}</TableCell>
                      <TableCell>{row.status || "-"}</TableCell>
                      <TableCell>{formatDate(row.createdAt)}</TableCell>
                      <TableCell>{formatDate(row.archivedAt)}</TableCell>
                    </TableRow>
                  ))}
                  {historyRows.length === 0 && (
                    <TableRow className="border-white/5">
                      <TableCell colSpan={5} className="text-center text-white/40 h-24">Sin resultados todavía. Ejecute una búsqueda o archive un lote primero.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Corridas recientes</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Dataset</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Corte</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Modo</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Estado</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Match</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Archivadas</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Eliminadas</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50 text-right">Restaurar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archiveRuns.slice(0, 12).map((run) => (
                    <TableRow key={run.id} className="border-white/5">
                      <TableCell>{String(run.entityType ?? "-")}</TableCell>
                      <TableCell>{String(run.cutoffDate ?? "-")}</TableCell>
                      <TableCell>{run.dryRun ? "Simulación" : "Real"}</TableCell>
                      <TableCell><Badge variant={getStatusVariant(String(run.status ?? ""))}>{String(run.status ?? "-")}</Badge></TableCell>
                      <TableCell>{Number(run.matchedCount ?? 0)}</TableCell>
                      <TableCell>{Number(run.archivedCount ?? 0)}</TableCell>
                      <TableCell>{Number(run.deletedCount ?? 0)}</TableCell>
                      <TableCell className="text-right">
                        {!run.dryRun && Number(run.archivedCount ?? 0) > 0 ? (
                          <Button
                            variant="outline"
                            className="border-white/10"
                            onClick={() => handleRestoreRun(run.id)}
                            disabled={restoringRunId === run.id}
                          >
                            {restoringRunId === run.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                            Restaurar
                          </Button>
                        ) : (
                          <span className="text-xs text-white/40">No aplica</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {archiveRuns.length === 0 && (
                    <TableRow className="border-white/5">
                      <TableCell colSpan={8} className="text-center text-white/40 h-24">Aun no hay corridas de archivado.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="bg-[#0c0c0c] border-white/5">
            <CardHeader>
              <CardTitle className="text-sm font-black uppercase tracking-wider text-white">Restauraciones recientes</CardTitle>
              <CardDescription>Auditoría de lotes devueltos desde archivo hacia tablas operativas.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow className="border-white/5">
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Dataset</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Run origen</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Modo</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Estado</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Match</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Restauradas</TableHead>
                    <TableHead className="text-[10px] uppercase font-black text-white/50">Removidas del archivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {restoreRuns.slice(0, 12).map((run) => (
                    <TableRow key={run.id} className="border-white/5">
                      <TableCell>{String(run.entityType ?? "-")}</TableCell>
                      <TableCell className="font-mono text-xs">{String(run.sourceRunId ?? "-")}</TableCell>
                      <TableCell>{run.dryRun ? "Simulación" : "Real"}</TableCell>
                      <TableCell><Badge variant={getStatusVariant(String(run.status ?? ""))}>{String(run.status ?? "-")}</Badge></TableCell>
                      <TableCell>{Number(run.matchedCount ?? 0)}</TableCell>
                      <TableCell>{Number(run.restoredCount ?? 0)}</TableCell>
                      <TableCell>{Number(run.removedFromArchiveCount ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                  {restoreRuns.length === 0 && (
                    <TableRow className="border-white/5">
                      <TableCell colSpan={7} className="text-center text-white/40 h-24">Aun no hay corridas de restauración.</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}