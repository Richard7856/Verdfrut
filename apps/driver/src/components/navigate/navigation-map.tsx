'use client';

// Mapa fullscreen para que el chofer vea su ruta completa, su posición actual
// y la próxima parada destacada. El mapa SE CENTRA automáticamente en el
// chofer la primera vez; después permite que el chofer haga pan/zoom libremente.
//
// Datos:
//   - depot + paradas (pre-cargadas, server-side)
//   - polyline de la ruta (Mapbox Directions cargada al montar)
//   - posición del chofer (tiempo real desde useDriverPosition)
//   - índice de la próxima parada pendiente (recibido como prop)
//
// Sin red: los tiles ya cargados siguen visibles. La polyline se cargó al
// inicio (o queda con líneas rectas como fallback). La posición del chofer
// usa GPS del teléfono (no requiere red).

import { useEffect, useRef, useState } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import type { DriverPosition } from '@/lib/use-driver-position';

export interface NavigationStop {
  /** id del registro en `stops` — usado para link a /route/stop/[id]. */
  stopId: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'completed' | 'skipped';
  lat: number;
  lng: number;
}

export interface NavigationDepot {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  stops: NavigationStop[];
  depot: NavigationDepot | null;
  geometry: GeoJSON.LineString | null;
  driverPosition: DriverPosition | null;
  /** ID de la parada destacada (la próxima pendiente). Se pinta más grande. */
  nextStopId: string | null;
  mapboxToken: string;
  className?: string;
}

const STATUS_COLORS = {
  pending: '#94a3b8',
  arrived: '#3b82f6',
  completed: '#16a34a',
  skipped: '#dc2626',
};

export function NavigationMap({
  stops,
  depot,
  geometry,
  driverPosition,
  nextStopId,
  mapboxToken,
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const stopMarkersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  // True hasta que el chofer hace pan/zoom — entonces dejamos de auto-centrar.
  const [autoFollow, setAutoFollow] = useState(true);

  // Init map once.
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    setMapboxToken(mapboxToken);

    // Centro inicial: cubrir todos los puntos del recorrido.
    const points: Array<[number, number]> = [];
    if (depot) points.push([depot.lng, depot.lat]);
    for (const s of stops) points.push([s.lng, s.lat]);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: points[0] ?? [-99.1332, 19.4326],
      zoom: 12,
    });
    mapRef.current = map;

    // Si el chofer interactúa, dejar de auto-centrar.
    map.on('dragstart', () => setAutoFollow(false));
    map.on('zoomstart', (e) => {
      // ignorar zooms programáticos.
      if ((e as unknown as { originalEvent?: unknown }).originalEvent) {
        setAutoFollow(false);
      }
    });

    map.on('load', () => {
      // Bounds inicial.
      if (points.length >= 2) {
        const bounds = new mapboxgl.LngLatBounds();
        for (const p of points) bounds.extend(p);
        map.fitBounds(bounds, { padding: 60, maxZoom: 13, duration: 0 });
      }

      // Depot marker.
      if (depot) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;background:#0f172a;border:2px solid white;' +
          'border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,0.3);';
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([depot.lng, depot.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 12 }).setHTML(
              `<div style="font-family:ui-sans-serif"><strong>${depot.code}</strong><br/>${depot.name}<br/><em>CEDIS</em></div>`,
            ),
          )
          .addTo(map);
      }

      // Polyline de la ruta planeada.
      if (geometry && geometry.coordinates.length >= 2) {
        map.addSource('route-line', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          paint: { 'line-color': '#16a34a', 'line-width': 5, 'line-opacity': 0.7 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
      stopMarkersRef.current.clear();
    };
  }, [depot, geometry, mapboxToken, stops]);

  // Renderizar/actualizar markers de paradas. Cuando cambia nextStopId,
  // re-pintamos para destacar el actual.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      for (const s of stops) {
        const isNext = s.stopId === nextStopId;
        const color = isNext ? '#16a34a' : STATUS_COLORS[s.status];
        const size = isNext ? 36 : 28;
        const fontSize = isNext ? 15 : 13;

        let marker = stopMarkersRef.current.get(s.stopId);
        if (marker) {
          // Recrear elemento para reflejar el nuevo color/size.
          marker.remove();
        }
        const el = document.createElement('div');
        el.style.cssText =
          `width:${size}px;height:${size}px;background:${color};border:3px solid white;` +
          `border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,0.3);` +
          `display:flex;align-items:center;justify-content:center;` +
          `color:white;font-weight:600;font-size:${fontSize}px;font-family:ui-sans-serif;` +
          (isNext ? 'animation:pulse 2s infinite;' : '');
        el.textContent = String(s.sequence);
        marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([s.lng, s.lat])
          .setPopup(
            new mapboxgl.Popup({ offset: 16 }).setHTML(
              `<div style="font-family:ui-sans-serif"><strong>#${s.sequence} · ${s.storeCode}</strong><br/>${s.storeName}</div>`,
            ),
          )
          .addTo(map);
        stopMarkersRef.current.set(s.stopId, marker);
      }
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [stops, nextStopId]);

  // Marker del chofer + auto-follow.
  // Ref para detectar la PRIMERA position recibida — en ese momento hacemos
  // fitBounds incluyendo chofer + próxima parada (no solo zoom in al chofer).
  // Útil cuando el chofer está lejos y necesita ver hacia dónde va.
  const isFirstPositionRef = useRef(true);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !driverPosition) return;
    const apply = () => {
      const lngLat: [number, number] = [driverPosition.lng, driverPosition.lat];
      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:34px;height:34px;background:#dc2626;border:3px solid white;' +
          'border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4);' +
          'display:flex;align-items:center;justify-content:center;font-size:20px;';
        el.textContent = '🚐';
        driverMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .addTo(map);
      } else {
        driverMarkerRef.current.setLngLat(lngLat);
      }
      if (!autoFollow) return;

      // Primera vez: ver chofer + próxima parada juntos.
      if (isFirstPositionRef.current) {
        isFirstPositionRef.current = false;
        const nextStop = stops.find((s) => s.stopId === nextStopId);
        if (nextStop) {
          const bounds = new mapboxgl.LngLatBounds();
          bounds.extend(lngLat);
          bounds.extend([nextStop.lng, nextStop.lat]);
          map.fitBounds(bounds, { padding: 80, maxZoom: 14, duration: 800 });
          return;
        }
      }
      // Resto del tiempo: seguir al chofer con zoom mínimo 14.
      map.easeTo({ center: lngLat, duration: 500, zoom: Math.max(map.getZoom(), 14) });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [driverPosition, autoFollow, stops, nextStopId]);

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="absolute inset-0" />
      {/* Botón "Centrar en mí" cuando el auto-follow está apagado. */}
      {!autoFollow && (
        <button
          type="button"
          onClick={() => setAutoFollow(true)}
          className="absolute right-3 top-3 rounded-full bg-white px-3 py-2 text-xs font-medium text-[var(--color-text)] shadow-md"
          style={{ zIndex: 10 }}
        >
          📍 Centrar en mí
        </button>
      )}
    </div>
  );
}
