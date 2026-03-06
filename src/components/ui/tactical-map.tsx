
"use client"

import { useEffect, useRef, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN

interface TacticalMapProps {
  center?: [number, number]
  zoom?: number
  markers?: Array<{
    lng: number
    lat: number
    color?: string
    title?: string
  }>
  interactive?: boolean
  onLocationSelect?: (lng: number, lat: number) => void
  className?: string
}

export function TacticalMap({
  center = [-84.0907, 9.9281], // San José, Costa Rica
  zoom = 12,
  markers = [],
  interactive = true,
  onLocationSelect,
  className = ""
}: TacticalMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const onLocationSelectRef = useRef<TacticalMapProps['onLocationSelect']>(onLocationSelect)
  const initialCenterRef = useRef<[number, number]>(center)
  const initialZoomRef = useRef<number>(zoom)
  const markersRef = useRef<mapboxgl.Marker[]>([])
  const markersSignatureRef = useRef<string>('')
  const updateMarkersRef = useRef<() => void>(() => {})
  const prevCenterRef = useRef<[number, number] | null>(null)
  const prevZoomRef = useRef<number | null>(null)

  const hasSameCenter = (a: [number, number] | null, b: [number, number]) => {
    if (!a) return false
    return Math.abs(a[0] - b[0]) < 0.000001 && Math.abs(a[1] - b[1]) < 0.000001
  }

  useEffect(() => {
    onLocationSelectRef.current = onLocationSelect
  }, [onLocationSelect])

  const updateMarkers = useCallback(() => {
    if (!map.current) return

    const signature = markers
      .map((m) => `${m.lng.toFixed(6)}:${m.lat.toFixed(6)}:${m.color ?? ''}:${m.title ?? ''}`)
      .join('|')

    if (signature === markersSignatureRef.current) return
    markersSignatureRef.current = signature

    // Limpiar marcadores existentes
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    // Añadir nuevos marcadores
    markers.forEach(markerData => {
      try {
        const marker = new mapboxgl.Marker({ 
          color: markerData.color || '#F59E0B',
          scale: 0.8
        })
          .setLngLat([markerData.lng, markerData.lat])
          .addTo(map.current!)
        
        if (markerData.title) {
          marker.setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(`
            <div class="p-2 font-sans">
              <p class="text-[10px] font-black uppercase text-black italic">${markerData.title}</p>
            </div>
          `))
        }
        
        markersRef.current.push(marker)
      } catch (e) {
        console.warn("Error al renderizar marcador:", e)
      }
    })
  }, [markers])

  useEffect(() => {
    updateMarkersRef.current = updateMarkers
  }, [updateMarkers])

  useEffect(() => {
    if (!mapContainer.current) return
    if (!MAPBOX_TOKEN) return
    if (map.current) return

    try {
      mapboxgl.accessToken = MAPBOX_TOKEN

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: initialCenterRef.current,
        zoom: initialZoomRef.current,
        interactive: interactive
      })

      prevCenterRef.current = initialCenterRef.current
      prevZoomRef.current = initialZoomRef.current

      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')
      map.current.addControl(
        new mapboxgl.GeolocateControl({
          positionOptions: { enableHighAccuracy: true },
          trackUserLocation: true,
          showUserHeading: true,
        }),
        'top-right'
      )

      if (onLocationSelectRef.current) {
        map.current.on('click', (e) => {
          onLocationSelectRef.current?.(e.lngLat.lng, e.lngLat.lat)
        })
      }

      map.current.on('load', () => {
        map.current?.resize()
        updateMarkersRef.current()
      })

    } catch (error) {
      console.error("Error inicializando Mapbox:", error)
    }

    return () => {
      markersRef.current.forEach(m => m.remove())
      map.current?.remove()
      map.current = null
    }
  }, [interactive])

  useEffect(() => {
    if (!map.current) return
    if (!map.current.loaded()) return
    const sameCenter = hasSameCenter(prevCenterRef.current, center)
    const sameZoom = prevZoomRef.current === zoom
    if (sameCenter && sameZoom) return

    const prevCenter = prevCenterRef.current
    const centerDelta = prevCenter
      ? Math.max(Math.abs(prevCenter[0] - center[0]), Math.abs(prevCenter[1] - center[1]))
      : 999
    const zoomDelta = Math.abs((prevZoomRef.current ?? zoom) - zoom)

    if (centerDelta < 0.0008 && zoomDelta < 0.05) {
      map.current.jumpTo({ center, zoom })
    } else {
      map.current.easeTo({ center, zoom, duration: 220, essential: true })
    }

    prevCenterRef.current = center
    prevZoomRef.current = zoom
  }, [center, zoom])

  useEffect(() => {
    if (map.current && map.current.loaded()) {
      updateMarkers()
    }
  }, [markers, updateMarkers])

  useEffect(() => {
    if (!map.current || !mapContainer.current) return

    const handleResize = () => map.current?.resize()
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(mapContainer.current)
    window.addEventListener('resize', handleResize)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  if (!MAPBOX_TOKEN) return (
    <div className={`bg-[#0c0c0c] rounded-md flex flex-col items-center justify-center gap-2 border border-white/5 ${className}`}>
      <div className="w-12 h-12 rounded-full border-2 border-white/10 flex items-center justify-center">
        <span className="text-2xl text-white/20">📍</span>
      </div>
      <span className="text-[10px] font-black uppercase text-white/30 tracking-widest">MAPA NO CONFIGURADO</span>
      <span className="text-[9px] text-white/20 text-center max-w-[220px]">Añade NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN (o NEXT_PUBLIC_MAPBOX_TOKEN) en .env.local</span>
    </div>
  )

  return (
    <div ref={mapContainer} className={`rounded-md overflow-hidden border border-white/5 bg-[#0a0a0a] ${className}`} />
  )
}
