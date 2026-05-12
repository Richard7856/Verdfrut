'use client';

// Mapa en vivo de UNA ruta IN_PROGRESS — el supervisor/dispatcher ve al chofer
// moviéndose en tiempo real.
//
// Diseño:
//   - Reusa <RouteMap> para depot, paradas, polyline.
//   - Encima dibuja un marker animado del chofer que se mueve con cada broadcast.
//   - Subscribe al canal Realtime `gps:{routeId}`.
//
// Sin GPS recibido todavía → marker no aparece (la ruta sí). Cuando llegue el
// primer broadcast, el marker aparece y luego se mueve suavemente.

import { useEffect, useRef, useState } from 'react';
import { mapboxgl, setMapboxToken } from '@tripdrive/maps';
import { createBrowserClient } from '@tripdrive/supabase/browser';
import { logger } from '@tripdrive/observability';
import type { RouteMapStop, RouteMapDepot } from './route-map';

interface DriverPosition {
  lat: number;
  lng: number;
  speed: number | null;     // m/s
  heading: number | null;   // grados
  ts: string;               // ISO
}

interface Props {
  routeId: string;
  stops: RouteMapStop[];
  depot: RouteMapDepot | null;
  geometry: GeoJSON.LineString | null;
  mapboxToken: string;
  /** Nombre del chofer para mostrar en popup. */
  driverName?: string;
}

const STATUS_COLORS: Record<RouteMapStop['status'], string> = {
  pending: '#94a3b8',
  arrived: '#3b82f6',
  completed: '#16a34a',
  skipped: '#dc2626',
};

export function LiveRouteMap({ routeId, stops, depot, geometry, mapboxToken, driverName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const driverMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [lastUpdateAgo, setLastUpdateAgo] = useState<string>('—');
  // Trail histórico: coords de breadcrumbs ya emitidos antes de montar el mapa.
  // Permite al supervisor que entra tarde ver dónde estuvo el chofer (issue #32).
  const [trail, setTrail] = useState<Array<[number, number]>>([]);

  // Cargar breadcrumbs una vez al montar.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/routes/${routeId}/breadcrumbs`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { breadcrumbs?: Array<{ lat: number; lng: number }> } | null) => {
        if (cancelled || !data?.breadcrumbs) return;
        setTrail(data.breadcrumbs.map((b) => [b.lng, b.lat] as [number, number]));
      })
      .catch((err) => {
        void logger.error('[breadcrumbs.fetch] error', { err, routeId });
      });
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  // Tick para mostrar "hace X seg" del último GPS.
  useEffect(() => {
    if (!position) return;
    const t = setInterval(() => {
      const seconds = Math.floor((Date.now() - new Date(position.ts).getTime()) / 1000);
      if (seconds < 60) setLastUpdateAgo(`hace ${seconds} s`);
      else if (seconds < 3600) setLastUpdateAgo(`hace ${Math.floor(seconds / 60)} min`);
      else setLastUpdateAgo(`hace ${Math.floor(seconds / 3600)} h`);
    }, 1000);
    return () => clearInterval(t);
  }, [position]);

  // Subscribe al canal Realtime.
  useEffect(() => {
    const supabase = createBrowserClient();
    const channel = supabase.channel(`gps:${routeId}`, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'position' }, ({ payload }) => {
        const p = payload as DriverPosition;
        // Validación defensiva — un broadcast malformado no debe romper el mapa.
        if (typeof p.lat === 'number' && typeof p.lng === 'number') {
          setPosition(p);
        }
      })
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, [routeId]);

  // Inicializar mapa una sola vez.
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    setMapboxToken(mapboxToken);

    const points: Array<[number, number]> = [];
    if (depot) points.push([depot.lng, depot.lat]);
    for (const s of stops) points.push([s.lng, s.lat]);
    if (points.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const p of points) bounds.extend(p);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      bounds,
      fitBoundsOptions: { padding: 50, maxZoom: 14 },
    });
    mapRef.current = map;

    // react-doctor-disable-next-line react-doctor/effect-needs-cleanup
    // Cleanup vía `map.remove()` en el return — Mapbox internamente desuscribe
    // todos los listeners (load, click, etc.) y destruye markers/layers.
    map.on('load', () => {
      // Depot.
      if (depot) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;background:#0f172a;border:2px solid white;' +
          'border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,0.3);';
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([depot.lng, depot.lat])
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<div style="font-family:ui-sans-serif;color:#0f172a"><strong>${depot.code}</strong><br/>${depot.name}<br/><em>CEDIS</em></div>`,
          ))
          .addTo(map);
      }

      // Paradas.
      for (const s of stops) {
        const el = document.createElement('div');
        const color = STATUS_COLORS[s.status];
        el.style.cssText =
          `width:28px;height:28px;background:${color};border:2px solid white;` +
          `border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);` +
          `display:flex;align-items:center;justify-content:center;` +
          `color:white;font-weight:600;font-size:13px;font-family:ui-sans-serif;`;
        el.textContent = String(s.sequence);
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([s.lng, s.lat])
          .setPopup(new mapboxgl.Popup({ offset: 16 }).setHTML(
            `<div style="font-family:ui-sans-serif;color:#0f172a"><strong>#${s.sequence} · ${s.storeCode}</strong><br/>${s.storeName}<br/><em>${s.status}</em></div>`,
          ))
          .addTo(map);
      }

      // Polyline planeada (verde sólido).
      if (geometry && geometry.coordinates.length >= 2) {
        map.addSource('route-line', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          paint: { 'line-color': '#16a34a', 'line-width': 4, 'line-opacity': 0.85 },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
      }

      // Trail histórico (rojo discreto) — el recorrido REAL que ya hizo el chofer.
      // Source vacío inicialmente; se rellena cuando llegan los breadcrumbs.
      map.addSource('driver-trail', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [] },
        },
      });
      map.addLayer({
        id: 'driver-trail',
        type: 'line',
        source: 'driver-trail',
        paint: {
          'line-color': '#dc2626',
          'line-width': 3,
          'line-opacity': 0.6,
          'line-dasharray': [1.5, 1],
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
      driverMarkerRef.current = null;
    };
  }, [stops, depot, geometry, mapboxToken]);

  // Actualizar el trail en el mapa cuando cambia. Concatena historial + última posición.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const src = map.getSource('driver-trail') as mapboxgl.GeoJSONSource | undefined;
      if (!src) return;
      const coords: Array<[number, number]> = [...trail];
      if (position) coords.push([position.lng, position.lat]);
      src.setData({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: coords },
      });
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
  }, [trail, position]);

  // Mover el marker del chofer cuando llega nueva posición.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;
    if (!map.isStyleLoaded()) {
      // Si el style aún no carga, esperamos al evento 'load'.
      map.once('load', () => updateDriverMarker(map, position));
    } else {
      updateDriverMarker(map, position);
    }
    function updateDriverMarker(m: mapboxgl.Map, p: DriverPosition) {
      const lngLat: [number, number] = [p.lng, p.lat];
      if (!driverMarkerRef.current) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:32px;height:32px;background:#dc2626;border:3px solid white;' +
          'border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.4);' +
          'display:flex;align-items:center;justify-content:center;font-size:18px;';
        el.textContent = '🚐';
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat(lngLat)
          .setPopup(
            new mapboxgl.Popup({ offset: 18 }).setHTML(
              `<div style="font-family:ui-sans-serif;color:#0f172a"><strong>${driverName ?? 'Chofer'}</strong><br/><em>posición en vivo</em></div>`,
            ),
          )
          .addTo(m);
        driverMarkerRef.current = marker;
      } else {
        driverMarkerRef.current.setLngLat(lngLat);
      }
    }
  }, [position, driverName]);

  if (!mapboxToken) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-sm text-[var(--color-text-muted)]">
        Mapa deshabilitado: configura NEXT_PUBLIC_MAPBOX_TOKEN.
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={containerRef}
        // ADR-045: contener los markers Mapbox al hacer scroll.
        style={{ isolation: 'isolate', transform: 'translateZ(0)' }}
        className="h-[500px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      />
      {/* Status overlay arriba a la derecha — el supervisor sabe si hay GPS o no.
          ADR-037: usa tokens del tema (no bg-white) para que respete dark mode. */}
      <div
        className="pointer-events-none absolute right-3 top-3 rounded-[var(--radius-md)] border px-3 py-1.5 text-xs shadow"
        style={{
          background: 'var(--vf-bg-elev)',
          borderColor: 'var(--vf-line)',
          color: 'var(--vf-text)',
        }}
      >
        {position ? (
          <span style={{ color: 'var(--vf-green-600,#15803d)' }}>
            ● En vivo · {lastUpdateAgo}
          </span>
        ) : (
          <span style={{ color: 'var(--color-text-muted)' }}>● Esperando GPS…</span>
        )}
      </div>
    </div>
  );
}
