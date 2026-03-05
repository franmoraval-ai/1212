"use client"

import { useState, useRef } from "react"
import { Camera, X, Plus, Download } from "lucide-react"
import { Button } from "./button"
import Image from "next/image"

interface Photo {
  id: string
  dataUrl: string
  timestamp: Date
}

interface PhotoCaptureProps {
  onPhotosChange?: (photos: Photo[]) => void
  maxPhotos?: number
}

export function PhotoCapture({ onPhotosChange, maxPhotos = 10 }: PhotoCaptureProps) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [showCamera, setShowCamera] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setShowCamera(true)
      }
    } catch (error) {
      console.error("Error al acceder a la cámara:", error)
    }
  }

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
      tracks.forEach(track => track.stop())
    }
    setShowCamera(false)
  }

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext("2d")
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth
        canvasRef.current.height = videoRef.current.videoHeight
        context.drawImage(videoRef.current, 0, 0)
        const dataUrl = canvasRef.current.toDataURL("image/jpeg", 0.8)
        
        const newPhoto: Photo = {
          id: `photo-${Date.now()}`,
          dataUrl,
          timestamp: new Date()
        }

        const updatedPhotos = [...photos, newPhoto]
        if (updatedPhotos.length >= maxPhotos) {
          stopCamera()
        }
        setPhotos(updatedPhotos)
        onPhotosChange?.(updatedPhotos)
      }
    }
  }

  const removePhoto = (id: string) => {
    const updatedPhotos = photos.filter(p => p.id !== id)
    setPhotos(updatedPhotos)
    onPhotosChange?.(updatedPhotos)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.currentTarget.files
    if (files) {
      Array.from(files).forEach(file => {
        const reader = new FileReader()
        reader.onload = (e) => {
          if (e.target?.result) {
            const newPhoto: Photo = {
              id: `photo-${Date.now()}-${Math.random()}`,
              dataUrl: e.target.result as string,
              timestamp: new Date()
            }
            setPhotos(prev => [...prev, newPhoto])
            onPhotosChange?.([...photos, newPhoto])
          }
        }
        reader.readAsDataURL(file)
      })
    }
  }

  const downloadPhoto = (photo: Photo) => {
    const link = document.createElement("a")
    link.href = photo.dataUrl
    link.download = `foto-${photo.timestamp.getTime()}.jpg`
    link.click()
  }

  return (
    <div className="space-y-6">
      {/* Cámara en vivo */}
      {showCamera && (
        <div className="relative bg-black rounded-lg overflow-hidden border border-white/10">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            className="w-full aspect-video bg-black"
          />
          <div className="absolute inset-0 flex items-center justify-center gap-4 pb-4" style={{ bottom: 0 }}>
            <Button
              onClick={capturePhoto}
              disabled={photos.length >= maxPhotos}
              className="bg-[#F59E0B] hover:bg-[#D97706] text-black font-black rounded-full w-16 h-16"
            >
              <Camera className="w-6 h-6" />
            </Button>
            <Button
              onClick={stopCamera}
              variant="outline"
              className="border-white/20 text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Indicador de cantidad */}
          <div className="absolute top-4 right-4 bg-black/80 px-3 py-1 rounded-full">
            <span className="text-[10px] font-black text-primary uppercase">
              {photos.length}/{maxPhotos}
            </span>
          </div>
        </div>
      )}

      {/* Botones de acción */}
      {!showCamera && photos.length < maxPhotos && (
        <div className="flex gap-3">
          <Button
            onClick={startCamera}
            className="flex-1 gap-2 bg-primary hover:bg-primary/90 text-black font-black"
          >
            <Camera className="w-4 h-4" />
            Capturar Foto
          </Button>
          <Button
            onClick={() => fileInputRef.current?.click()}
            variant="outline"
            className="flex-1 gap-2 border-white/20 text-white"
          >
            <Plus className="w-4 h-4" />
            Subir Foto
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      )}

      {/* Galería de fotos */}
      {photos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-black text-primary uppercase tracking-widest">
              FOTOS CAPTURADAS ({photos.length})
            </h3>
            {photos.length > 0 && (
              <Button
                onClick={() => {
                  setPhotos([])
                  onPhotosChange?.([])
                }}
                variant="ghost"
                size="sm"
                className="text-red-400 hover:text-red-300"
              >
                <X className="w-4 h-4 mr-1" />
                Limpiar
              </Button>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {photos.map((photo) => (
              <div key={photo.id} className="relative group">
                <div className="relative aspect-square bg-black rounded-lg overflow-hidden border border-white/10">
                  <img
                    src={photo.dataUrl}
                    alt="Captura"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                    <button
                      onClick={() => downloadPhoto(photo)}
                      className="p-1.5 bg-primary/80 hover:bg-primary rounded-full text-black"
                      title="Descargar"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removePhoto(photo.id)}
                      className="p-1.5 bg-red-500/80 hover:bg-red-600 rounded-full text-white"
                      title="Eliminar"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <span className="text-[8px] text-white/50 truncate block mt-1">
                  {photo.timestamp.toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Canvas oculto */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
