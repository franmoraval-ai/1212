"use client"

import { QRCodeSVG } from "qrcode.react"
import { Download } from "lucide-react"
import { Button } from "./button"
import { useRef } from "react"

interface RoundQRProps {
  id: string
  name: string
  post?: string
  size?: number
}

export function RoundQR({ id, name, post, size = 200 }: RoundQRProps) {
  const qrRef = useRef<HTMLDivElement>(null)

  const qrValue = JSON.stringify({
    id,
    name,
    post,
    timestamp: new Date().toISOString()
  })

  const downloadQR = () => {
    if (qrRef.current) {
      const svg = qrRef.current.querySelector("svg")
      if (svg) {
        const canvas = document.createElement("canvas")
        const svgString = new XMLSerializer().serializeToString(svg)
        const img = new Image()
        img.onload = () => {
          canvas.width = img.width
          canvas.height = img.height
          const ctx = canvas.getContext("2d")
          if (ctx) {
            ctx.fillStyle = "white"
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, 0, 0)
            const link = document.createElement("a")
            link.href = canvas.toDataURL("image/png")
            link.download = `qr-ronda-${name}-${id}.png`
            link.click()
          }
        }
        img.src = `data:image/svg+xml;base64,${btoa(svgString)}`
      }
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6 bg-white/5 border border-white/10 rounded-lg">
      <div
        ref={qrRef}
        className="p-4 bg-white rounded-lg shadow-lg"
      >
        <QRCodeSVG
          value={qrValue}
          size={size}
          level="H"
          includeMargin={true}
          fgColor="#000000"
          bgColor="#FFFFFF"
        />
      </div>
      
      <div className="text-center space-y-1">
        <p className="text-[10px] font-black text-primary uppercase tracking-widest">
          QR RONDA: {name}
        </p>
        <p className="text-[9px] text-white/50">
          ID: {id.slice(0, 8)}...
        </p>
      </div>

      <Button
        onClick={downloadQR}
        size="sm"
        className="gap-2 bg-primary hover:bg-primary/90 text-black font-black w-full"
      >
        <Download className="w-4 h-4" />
        Descargar QR
      </Button>
    </div>
  )
}
