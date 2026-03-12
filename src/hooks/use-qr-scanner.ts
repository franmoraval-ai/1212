"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import jsQR from "jsqr"

type UseQrScannerOptions = {
  onDetected: (value: string) => void
  scanIntervalMs?: number
  autoStopOnDetected?: boolean
  errorNoCamera?: string
  errorCameraStart?: string
}

type BarcodeDetectorLike = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>
}

export function useQrScanner(options: UseQrScannerOptions) {
  const {
    onDetected,
    scanIntervalMs = 350,
    autoStopOnDetected = false,
    errorNoCamera = "Este navegador no permite acceso a la camara.",
    errorCameraStart = "No se pudo iniciar la camara. Verifique permisos.",
  } = options

  const [isScanning, setIsScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [qrSupported] = useState(() => typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanTimerRef = useRef<number | null>(null)
  const scanBusyRef = useRef(false)
  const onDetectedRef = useRef(onDetected)

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  const stopScanner = useCallback(() => {
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
  }, [])

  const startScanner = useCallback(async () => {
    setScanError(null)

    if (!("mediaDevices" in navigator) || !navigator.mediaDevices?.getUserMedia) {
      setScanError(errorNoCamera)
      return
    }

    const DetectorCtor = (window as unknown as {
      BarcodeDetector?: new (opts?: { formats?: string[] }) => BarcodeDetectorLike
    }).BarcodeDetector

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }

      let detector: BarcodeDetectorLike | null = null
      if (DetectorCtor) {
        detector = new DetectorCtor({ formats: ["qr_code"] })
      }

      const fallbackCanvas = document.createElement("canvas")
      const fallbackCtx = fallbackCanvas.getContext("2d", { willReadFrequently: true })
      setIsScanning(true)

      scanTimerRef.current = window.setInterval(async () => {
        if (!videoRef.current || videoRef.current.readyState < 2 || scanBusyRef.current) return
        scanBusyRef.current = true

        try {
          let rawValue = ""

          if (detector) {
            const codes = await detector.detect(videoRef.current)
            rawValue = codes?.[0]?.rawValue?.trim() ?? ""
          }

          if (!rawValue && fallbackCtx && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
            fallbackCanvas.width = videoRef.current.videoWidth
            fallbackCanvas.height = videoRef.current.videoHeight
            fallbackCtx.drawImage(videoRef.current, 0, 0, fallbackCanvas.width, fallbackCanvas.height)
            const frame = fallbackCtx.getImageData(0, 0, fallbackCanvas.width, fallbackCanvas.height)
            const decoded = jsQR(frame.data, frame.width, frame.height, { inversionAttempts: "attemptBoth" })
            rawValue = decoded?.data?.trim() ?? ""
          }

          if (!rawValue) return

          onDetectedRef.current(rawValue)
          if (autoStopOnDetected) {
            stopScanner()
          }
        } catch {
          // Ignorar errores transitorios por frame.
        } finally {
          scanBusyRef.current = false
        }
      }, scanIntervalMs)
    } catch {
      setScanError(errorCameraStart)
      stopScanner()
    }
  }, [autoStopOnDetected, errorCameraStart, errorNoCamera, scanIntervalMs, stopScanner])

  useEffect(() => {
    return () => {
      stopScanner()
    }
  }, [stopScanner])

  return {
    videoRef,
    isScanning,
    scanError,
    qrSupported,
    startScanner,
    stopScanner,
  }
}
