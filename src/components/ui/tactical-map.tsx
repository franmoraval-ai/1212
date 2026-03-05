
"use client"

import { useEffect, useRef, useState, useCallback } from 'react'
import mapboxgl from 'mapbox-gl'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN

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
  const markersRef = useRef<mapboxgl.Marker[]>([])

  useEffect(() => {
    onLocationSelectRef.current = onLocationSelect
  }, [onLocationSelect])

  const updateMarkers = useCallback(() => {
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
  }, [markers])

  useEffect(() => {
    if (!mapContainer.current) return
    if (!MAPBOX_TOKEN) return
    if (map.current) return

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

      if (onLocationSelectRef.current) {
        map.current.on('click', (e) => {
          onLocationSelectRef.current?.(e.lngLat.lng, e.lngLat.lat)
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
      map.current = null
    }
  }, [interactive, center, zoom, updateMarkers])

  useEffect(() => {
    if (!map.current) return
    map.current.easeTo({ center, zoom, duration: 300 })
  }, [center, zoom])

  useEffect(() => {
    if (map.current && map.current.loaded()) {
      updateMarkers()
    }
  }, [markers, updateMarkers])

  if (!MAPBOX_TOKEN) return (
    <div className={`bg-[#0c0c0c] rounded-md flex flex-col items-center justify-center gap-2 border border-white/5 ${className}`}>
      <div className="w-12 h-12 rounded-full border-2 border-white/10 flex items-center justify-center">
        <span className="text-2xl text-white/20">📍</span>
      </div>
      <span className="text-[10px] font-black uppercase text-white/30 tracking-widest">MAPA NO CONFIGURADO</span>
      <span className="text-[9px] text-white/20 text-center max-w-[200px]">Añade NEXT_PUBLIC_MAPBOX_TOKEN en .env.local</span>
    </div>
  )

  return (
    <div ref={mapContainer} className={`rounded-md overflow-hidden border border-white/5 bg-[#0a0a0a] ${className}`} />
  )
}
