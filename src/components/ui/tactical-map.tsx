
"use client"

import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'

/**
 * Token de acceso institucional para Mapbox de HO SEGURIDAD.
 * Configurar en .env.local: NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ...
 */
const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''

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
  const [mounted, setMounted] = useState(false)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!mounted || !mapContainer.current) return

    try {
      mapboxgl.accessToken = MAPBOX_TOKEN

      map.current = new mapboxgl.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: center,
        zoom: zoom,
        interactive: interactive
      })

      map.current.addControl(new mapboxgl.NavigationControl(), 'top-right')

      if (onLocationSelect) {
        map.current.on('click', (e) => {
          onLocationSelect(e.lngLat.lng, e.lngLat.lat)
        })
      }

      map.current.on('load', () => {
        updateMarkers()
      })

    } catch (error) {
      console.error("Error inicializando Mapbox:", error)
    }

    return () => {
      markersRef.current.forEach(m => m.remove())
      map.current?.remove()
    }
  }, [mounted])

  // Efecto separado para actualizar marcadores sin recrear el mapa
  useEffect(() => {
    if (map.current && map.current.loaded()) {
      updateMarkers()
    }
  }, [markers])

  const updateMarkers = () => {
    if (!map.current) return

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
  }

  if (!mounted) return (
    <div className={`bg-[#0c0c0c] animate-pulse rounded-md flex items-center justify-center ${className}`}>
      <span className="text-[10px] font-black uppercase text-white/20 tracking-widest">Sincronizando Satélite...</span>
    </div>
  )

  return (
    <div ref={mapContainer} className={`rounded-md overflow-hidden border border-white/5 bg-[#0a0a0a] ${className}`} />
  )
}
