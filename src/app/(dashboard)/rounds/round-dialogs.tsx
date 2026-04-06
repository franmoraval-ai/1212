// Extracted dialog sub-components for rounds/page.tsx
// Each dialog receives its state and handlers as props to keep them self-contained.
"use client"

import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Camera, Download, Eye, Loader2, Plus, ScanLine, X } from "lucide-react"
import type { RoundReportRow, RoundCheckpoint, GpsPoint, GpxWaypoint } from "./round-helpers"
import {
  getStoredAlertMessages, getRoundReportCode, getReportCreatedDate,
  getRoundLogDetails, getRoundLogPhotos, buildTrackSvgPath,
} from "./round-helpers"

// ── QR Scanner Dialog ────────────────────────────────────────────────

type QrScannerDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  pendingStartByQr: boolean
  videoRef: React.RefObject<HTMLVideoElement | null>
  isScanning: boolean
  scanError: string | null
  qrSupported: boolean
  canManualCheckpointValidation: boolean
  qrInput: string
  onQrInputChange: (value: string) => void
  onApplyManual: () => void
}

export function QrScannerDialog({
  open, onOpenChange, pendingStartByQr, videoRef, isScanning, scanError,
  qrSupported, canManualCheckpointValidation, qrInput, onQrInputChange, onApplyManual,
}: QrScannerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Lector QR</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            {pendingStartByQr ? "Escanee el codigo de inicio QR/NFC asignado para arrancar la ronda." : "Escanee QR de ronda o checkpoint. NFC disponible desde boton dedicado."}
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
          {!qrSupported && <p className="text-[10px] text-amber-400 font-bold uppercase">Este navegador no soporta lectura QR por camara.</p>}

          {canManualCheckpointValidation ? (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase font-black text-white/70">Ingreso manual</Label>
              <Textarea
                value={qrInput}
                onChange={(e) => onQrInputChange(e.target.value)}
                className="bg-black/30 border-white/10 min-h-[70px]"
                placeholder="Pegue aqui el contenido del QR"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter>
          {canManualCheckpointValidation ? (
            <Button
              variant="outline"
              className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
              onClick={onApplyManual}
            >
              Aplicar manual
            </Button>
          ) : (
            <p className="text-[10px] text-white/50 uppercase">Ingreso manual habilitado solo para L4</p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Checkpoint Code Editor Dialog ────────────────────────────────────

type CheckpointCodeEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  qrText: string
  onQrTextChange: (value: string) => void
  nfcText: string
  onNfcTextChange: (value: string) => void
  saving: boolean
  onSave: () => void
}

export function CheckpointCodeEditorDialog({
  open, onOpenChange, name, qrText, onQrTextChange, nfcText, onNfcTextChange, saving, onSave,
}: CheckpointCodeEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Editar NFC / QR</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            Override operativo L4 para {name || "checkpoint"} mientras se sustituye la etiqueta física.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">QR válidos</Label>
            <Textarea
              value={qrText}
              onChange={(e) => onQrTextChange(e.target.value)}
              className="bg-black/30 border-white/10 min-h-[90px]"
              placeholder="Un código por línea o separados por coma"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">NFC válidos</Label>
            <Textarea
              value={nfcText}
              onChange={(e) => onNfcTextChange(e.target.value)}
              className="bg-black/30 border-white/10 min-h-[90px]"
              placeholder="Un token NFC por línea o separados por coma"
            />
          </div>
          <p className="text-[10px] text-cyan-200 uppercase leading-5">
            El cambio aplica de inmediato en la ronda actual y también intenta actualizar la definición guardada de la ronda.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" className="bg-primary text-black font-black uppercase" disabled={saving} onClick={onSave}>
            {saving ? "Guardando..." : "Guardar cambio"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Quick Incident Dialog ────────────────────────────────────────────

type QuickIncidentDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  location: string
  type: string
  onTypeChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
  saving: boolean
  onSave: () => void
}

export function QuickIncidentDialog({
  open, onOpenChange, location, type, onTypeChange, description, onDescriptionChange, saving, onSave,
}: QuickIncidentDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Novedad rápida</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            Registro operativo sin salir de la ronda activa.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Ubicación</Label>
            <Input value={location} readOnly className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Tipo</Label>
            <Input value={type} onChange={(e) => onTypeChange(e.target.value)} placeholder="Puerta abierta, visita, novedad, daño..." className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Descripción</Label>
            <Textarea value={description} onChange={(e) => onDescriptionChange(e.target.value)} placeholder="Describa brevemente la novedad detectada" className="bg-black/30 border-white/10 min-h-[100px]" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button className="bg-primary text-black font-black uppercase" onClick={onSave} disabled={saving}>
            {saving ? "Guardando..." : "Guardar novedad"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── History Track Dialog ─────────────────────────────────────────────

type HistoryTrackDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: RoundReportRow | null
  track: GpsPoint[]
  trackPath: string
  mapCenter: [number, number]
  mapMarkers: Array<{ lng: number; lat: number; color?: string; title?: string }>
  TacticalMapComponent: React.ComponentType<{
    className?: string
    center?: [number, number]
    zoom?: number
    interactive?: boolean
    markers?: Array<{ lng: number; lat: number; color?: string; title?: string }>
    routePath?: Array<{ lng: number; lat: number }>
  }>
  onDownloadGpx: (report: RoundReportRow) => void
}

export function HistoryTrackDialog({
  open, onOpenChange, report, track, trackPath, mapCenter, mapMarkers, TacticalMapComponent, onDownloadGpx,
}: HistoryTrackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Ruta de boleta</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            {report ? `${String(report.roundName ?? "Ronda")} - ${String(report.officerName ?? "Oficial")}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="h-[240px] rounded border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
            {track.length >= 2 ? (
              <TacticalMapComponent
                className="w-full h-full"
                center={mapCenter}
                zoom={15}
                interactive={true}
                markers={mapMarkers}
                routePath={track.map((p) => ({ lng: p.lng, lat: p.lat }))}
              />
            ) : (
              <p className="text-[10px] text-white/50 uppercase">Sin trazado disponible</p>
            )}
          </div>

          {trackPath ? (
            <div className="h-[100px] rounded border border-white/10 bg-black/40 flex items-center justify-center overflow-hidden">
              <svg width="100%" height="100%" viewBox="0 0 520 220" preserveAspectRatio="none">
                <path d={trackPath} stroke="#22d3ee" strokeWidth="2" fill="none" />
              </svg>
            </div>
          ) : null}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
            <div className="rounded border border-white/10 bg-black/30 p-2">
              <p className="uppercase text-white/50 font-black">Puntos GPS</p>
              <p className="text-white font-black">{track.length}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-2">
              <p className="uppercase text-white/50 font-black">Avance</p>
              <p className="text-white font-black">{Number(report?.checkpointsCompleted ?? 0)}/{Number(report?.checkpointsTotal ?? 0)}</p>
            </div>
            <div className="rounded border border-white/10 bg-black/30 p-2">
              <p className="uppercase text-white/50 font-black">Alertas</p>
              <p className="text-white font-black">{report ? getStoredAlertMessages(report).length : 0}</p>
            </div>
          </div>

          {report && getStoredAlertMessages(report).length > 0 ? (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2">
              <p className="text-[10px] uppercase font-black text-amber-200 mb-1">Alertas detectadas</p>
              <div className="space-y-1">
                {getStoredAlertMessages(report).map((msg, idx) => (
                  <p key={`${msg}-${idx}`} className="text-[10px] text-amber-100">- {msg}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="border-white/20 text-white hover:bg-white/10 font-black uppercase"
            onClick={() => report && onDownloadGpx(report)}
            disabled={!report || track.length < 2}
          >
            <Download className="w-4 h-4 mr-1" /> Descargar GPX
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── History Detail Dialog ────────────────────────────────────────────

type HistoryDetailDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  report: RoundReportRow | null
  onOpenPhoto: (photo: string) => void
  onDownloadPhoto: (report: RoundReportRow, photo: string, index: number) => void
  onDownloadAllPhotos: (report: RoundReportRow) => void
}

export function HistoryDetailDialog({
  open, onOpenChange, report, onOpenPhoto, onDownloadPhoto, onDownloadAllPhotos,
}: HistoryDetailDialogProps) {
  if (!report) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-black uppercase tracking-wider">Informacion de boleta de ronda</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  const detailPhotos = getRoundLogPhotos(report)
  const details = getRoundLogDetails(report)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Informacion de boleta de ronda</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            {`${String(report.roundName ?? "Ronda")} - ${String(report.officerName ?? "Oficial")}`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-[11px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            <div><span className="text-white/50">Codigo:</span> {getRoundReportCode(report)}</div>
            <div><span className="text-white/50">Fecha:</span> {getReportCreatedDate(report)?.toLocaleString?.() ?? "-"}</div>
            <div><span className="text-white/50">Ronda:</span> {String(report.roundName ?? "-")}</div>
            <div><span className="text-white/50">Lugar:</span> {String(report.postName ?? "-")}</div>
            <div><span className="text-white/50">Oficial:</span> {String(report.officerName ?? "-")}</div>
            <div><span className="text-white/50">Supervisor:</span> {String(report.supervisorName ?? report.supervisorId ?? "-")}</div>
            <div><span className="text-white/50">Estado:</span> {String(report.status ?? "-")}</div>
            <div><span className="text-white/50">Avance:</span> {Number(report.checkpointsCompleted ?? 0)}/{Number(report.checkpointsTotal ?? 0)}</div>
          </div>

          <div className="rounded border border-white/10 bg-black/30 p-3 grid grid-cols-2 md:grid-cols-3 gap-2 text-[10px]">
            <div>
              <p className="text-white/50 uppercase font-black">Pre-ronda</p>
              <p className="font-black">{details.preRoundCondition}</p>
            </div>
            <div>
              <p className="text-white/50 uppercase font-black">Distancia</p>
              <p className="font-black">{details.distanceKm} km</p>
            </div>
            <div>
              <p className="text-white/50 uppercase font-black">Duracion</p>
              <p className="font-black">{details.duration}</p>
            </div>
            <div>
              <p className="text-white/50 uppercase font-black">Evidencias</p>
              <p className="font-black">{details.evidenceCount}</p>
            </div>
            <div>
              <p className="text-white/50 uppercase font-black">Eventos QR</p>
              <p className="font-black">{details.eventsCount}</p>
            </div>
            <div>
              <p className="text-white/50 uppercase font-black">Alertas</p>
              <p className="font-black">{getStoredAlertMessages(report).length}</p>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-white/50 uppercase font-black mb-1">Observaciones</p>
            <p className="text-[11px] whitespace-pre-wrap text-white/80">{String(report.notes ?? "-")}</p>
          </div>

          <div>
            <p className="text-[10px] text-white/50 uppercase font-black mb-1">Notas pre-ronda</p>
            <p className="text-[11px] whitespace-pre-wrap text-white/80">{details.preRoundNotes}</p>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] text-white/50 uppercase font-black">Evidencias ({detailPhotos.length})</p>
              {detailPhotos.length > 0 ? (
                <Button type="button" variant="outline" size="sm" className="border-white/20 text-white hover:bg-white/10 h-8" onClick={() => onDownloadAllPhotos(report)}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Descargar todas
                </Button>
              ) : null}
            </div>
            {detailPhotos.length === 0 ? (
              <p className="text-[11px] whitespace-pre-wrap text-white/50">Sin evidencias adjuntas.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {detailPhotos.map((photo, index) => (
                  <div key={`${photo.slice(0, 30)}-${index}`} className="space-y-2">
                    <button type="button" className="relative block aspect-square w-full rounded overflow-hidden border border-white/10" onClick={() => onOpenPhoto(photo)}>
                      <Image src={photo} alt={`Evidencia ${index + 1}`} fill unoptimized sizes="(max-width: 640px) 50vw, 20vw" className="object-cover" />
                    </button>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" className="flex-1 border-white/20 text-white hover:bg-white/10 h-8" onClick={() => onOpenPhoto(photo)}>
                        <Eye className="w-3.5 h-3.5 mr-1" /> Ver
                      </Button>
                      <Button type="button" variant="outline" size="sm" className="flex-1 border-white/20 text-white hover:bg-white/10 h-8" onClick={() => onDownloadPhoto(report, photo, index)}>
                        <Download className="w-3.5 h-3.5 mr-1" /> Bajar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── History Edit Dialog ──────────────────────────────────────────────

type HistoryEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  roundName: string
  onRoundNameChange: (value: string) => void
  postName: string
  onPostNameChange: (value: string) => void
  officerName: string
  onOfficerNameChange: (value: string) => void
  supervisorName: string
  onSupervisorNameChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  notes: string
  onNotesChange: (value: string) => void
  saving: boolean
  onSave: () => void
}

export function HistoryEditDialog({
  open, onOpenChange, roundName, onRoundNameChange, postName, onPostNameChange,
  officerName, onOfficerNameChange, supervisorName, onSupervisorNameChange,
  status, onStatusChange, notes, onNotesChange, saving, onSave,
}: HistoryEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Editar boleta de ronda (L4)</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            Corrija nombre de oficial, supervisor, estado u observaciones.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Ronda</Label>
            <Input value={roundName} onChange={(e) => onRoundNameChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Lugar</Label>
            <Input value={postName} onChange={(e) => onPostNameChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Oficial</Label>
            <Input value={officerName} onChange={(e) => onOfficerNameChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Supervisor</Label>
            <Input value={supervisorName} onChange={(e) => onSupervisorNameChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
            <Select value={status} onValueChange={onStatusChange}>
              <SelectTrigger className="bg-black/30 border-white/10"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPLETA">COMPLETA</SelectItem>
                <SelectItem value="PARCIAL">PARCIAL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-[10px] uppercase font-black text-white/70">Observaciones</Label>
            <Textarea value={notes} onChange={(e) => onNotesChange(e.target.value)} className="bg-black/30 border-white/10 min-h-[90px] text-white" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" className="bg-primary text-black font-black uppercase" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Round Definition Edit Dialog ─────────────────────────────────────

type RoundEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  onNameChange: (value: string) => void
  post: string
  onPostChange: (value: string) => void
  status: string
  onStatusChange: (value: string) => void
  frequency: string
  onFrequencyChange: (value: string) => void
  instructions: string
  onInstructionsChange: (value: string) => void
  checkpoints: RoundCheckpoint[]
  onCheckpointsChange: (value: RoundCheckpoint[]) => void
  saving: boolean
  onSave: () => void
}

export function RoundEditDialog({
  open, onOpenChange, name, onNameChange, post, onPostChange,
  status, onStatusChange, frequency, onFrequencyChange,
  instructions, onInstructionsChange, checkpoints, onCheckpointsChange,
  saving, onSave,
}: RoundEditDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Editar ronda (L4)</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            Ajuste datos generales de la ronda seleccionada.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Nombre ronda</Label>
            <Input value={name} onChange={(e) => onNameChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Puesto</Label>
            <Input value={post} onChange={(e) => onPostChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Estado</Label>
            <Input value={status} onChange={(e) => onStatusChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase font-black text-white/70">Frecuencia</Label>
            <Input value={frequency} onChange={(e) => onFrequencyChange(e.target.value)} className="bg-black/30 border-white/10 text-white" />
          </div>
          <div className="space-y-2 md:col-span-2">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] uppercase font-black text-white/70">Points / Checkpoints</Label>
              <Button
                type="button"
                variant="outline"
                className="h-7 border-white/20 text-white hover:bg-white/10 text-[9px] font-black uppercase"
                onClick={() => onCheckpointsChange([...checkpoints, { name: `Punto ${checkpoints.length + 1}` }])}
              >
                <Plus className="w-3 h-3 mr-1" /> Agregar point
              </Button>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
              {checkpoints.length === 0 ? (
                <p className="text-[10px] text-white/50 uppercase">Sin points configurados.</p>
              ) : (
                checkpoints.map((cp, index) => (
                  <div key={`round-edit-cp-${index}`} className="flex items-center gap-2">
                    <Input
                      value={String(cp.name ?? "")}
                      onChange={(e) => onCheckpointsChange(checkpoints.map((item, i) => i === index ? { ...item, name: e.target.value } : item))}
                      className="bg-black/30 border-white/10 text-white"
                      placeholder={`Punto ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 w-8 text-white/50 hover:text-red-300 hover:bg-red-500/10"
                      onClick={() => onCheckpointsChange(checkpoints.filter((_, i) => i !== index))}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-[10px] uppercase font-black text-white/70">Instrucciones</Label>
            <Textarea value={instructions} onChange={(e) => onInstructionsChange(e.target.value)} className="bg-black/30 border-white/10 min-h-[90px] text-white" />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" className="border-white/20 text-white hover:bg-white/10 font-black uppercase" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" className="bg-primary text-black font-black uppercase" onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            Guardar cambios
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── AI Summary Dialog ────────────────────────────────────────────────

type AiSummaryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportCode: string
  loading: boolean
  text: string
}

export function AiSummaryDialog({ open, onOpenChange, reportCode, loading, text }: AiSummaryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-black border-white/10 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm font-black uppercase tracking-wider">Resumen IA de boleta</DialogTitle>
          <DialogDescription className="text-[10px] text-white/60 uppercase">
            {reportCode ? `Boleta ${reportCode}` : "Analisis operativo"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="h-24 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="rounded border border-white/10 bg-black/30 p-3 max-h-[60vh] overflow-y-auto">
            <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-white/90 font-sans">
              {text || "Sin contenido."}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
