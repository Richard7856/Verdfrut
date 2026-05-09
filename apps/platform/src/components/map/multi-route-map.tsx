'use client';

// Mapa con múltiples rutas (vista del día). Cada ruta tiene un color distinto.
// Útil para que el dispatcher revise visualmente que las rutas no se cruzan
// innecesariamente y que cada chofer tiene una zona razonable.
//
// Diseño:
//   - Una polyline por ruta, color tomado de palette circular.
//   - Marcador del depot común (cuadrado oscuro).
//   - Paradas como círculos numerados con el color de su ruta.
//   - Leyenda lateral con vehículo + nombre de ruta + click para resaltar.
//
// Performance: cada ruta hace 1 fetch a /api/routes/[id]/polyline. Para 5-10
// rutas/día es despreciable. Para 50+ tendríamos que cachear o bulk endpoint.

import { useEffect, useMemo, useRef, useState } from 'react';
import { mapboxgl, setMapboxToken } from '@verdfrut/maps';

export interface MultiRouteEntry {
  routeId: string;
  routeName: string;
  vehicleLabel: string;
  /** Mismo orden que el optimizer asignó. */
  stops: Array<{
    storeCode: string;
    storeName: string;
    sequence: number;
    lat: number;
    lng: number;
    /** ADR-039: extra contexto en popup. */
    address?: string | null;
    plannedArrivalAt?: string | null;
    status?: 'pending' | 'arrived' | 'completed' | 'skipped';
  }>;
  /** Coords del depot de este vehículo (puede repetirse entre rutas con el mismo CEDIS). */
  depot: { code: string; name: string; lat: number; lng: number } | null;
}

interface Props {
  routes: MultiRouteEntry[];
  mapboxToken: string;
  className?: string;
}

// Palette para hasta ~12 rutas distintas. Si crece, se rota.
const PALETTE = [
  '#16a34a', // verde
  '#2563eb', // azul
  '#dc2626', // rojo
  '#f59e0b', // ámbar
  '#7c3aed', // violeta
  '#0891b2', // cian
  '#db2777', // rosa
  '#ca8a04', // dorado
  '#059669', // esmeralda
  '#9333ea', // morado
  '#0284c7', // azul cielo
  '#e11d48', // rosa fuerte
];

export function MultiRouteMap({ routes, mapboxToken, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  // Memorizar asignación de color por ruta (estable entre re-renders).
  const colorByRoute = useMemo(() => {
    const map = new Map<string, string>();
    routes.forEach((r, i) => map.set(r.routeId, PALETTE[i % PALETTE.length]!));
    return map;
  }, [routes]);

  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    setMapboxToken(mapboxToken);

    // bbox que cubra todo: depots + paradas.
    const allPoints: Array<[number, number]> = [];
    for (const r of routes) {
      if (r.depot) allPoints.push([r.depot.lng, r.depot.lat]);
      for (const s of r.stops) allPoints.push([s.lng, s.lat]);
    }
    if (allPoints.length === 0) return;

    const bounds = new mapboxgl.LngLatBounds();
    for (const p of allPoints) bounds.extend(p);

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      bounds,
      fitBoundsOptions: { padding: 60, maxZoom: 13 },
    });
    mapRef.current = map;

    map.on('load', async () => {
      // Depots (uniqued por code+coords — varias rutas comparten CEDIS).
      const seenDepots = new Set<string>();
      for (const r of routes) {
        if (!r.depot) continue;
        const key = `${r.depot.code}-${r.depot.lat},${r.depot.lng}`;
        if (seenDepots.has(key)) continue;
        seenDepots.add(key);
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;background:#0f172a;border:2px solid white;' +
          'border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,0.3);';
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([r.depot.lng, r.depot.lat])
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<div style="font-family:ui-sans-serif;color:#0f172a"><strong>${r.depot.code}</strong><br/>${r.depot.name}<br/><em>CEDIS</em></div>`,
          ))
          .addTo(map);
      }

      // Paradas + polyline por ruta. Polyline en paralelo (fetch /polyline).
      await Promise.all(
        routes.map(async (r) => {
          const color = colorByRoute.get(r.routeId)!;

          // Markers numerados con el color de la ruta.
          for (const s of r.stops) {
            const el = document.createElement('div');
            el.style.cssText =
              `width:24px;height:24px;background:${color};border:2px solid white;` +
              `border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);` +
              `display:flex;align-items:center;justify-content:center;` +
              `color:white;font-weight:600;font-size:11px;font-family:ui-sans-serif;`;
            el.textContent = String(s.sequence);
            // ADR-039: popup enriquecido — ETA + dirección + status + CTA "Ver ruta"
            const tz = 'America/Mexico_City';
            const eta = s.plannedArrivalAt
              ? new Intl.DateTimeFormat('es-MX', {
                  timeZone: tz,
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }).format(new Date(s.plannedArrivalAt))
              : null;
            const STATUS_LABEL_ES: Record<NonNullable<typeof s.status>, string> = {
              pending: 'Pendiente',
              arrived: 'En sitio',
              completed: 'Completada',
              skipped: 'Omitida',
            };
            const popupHTML =
              `<div style="font-family:ui-sans-serif;color:#0f172a;min-width:200px;max-width:280px">` +
                `<div style="font-size:11px;color:#64748b;margin-bottom:2px">${r.routeName} · ${r.vehicleLabel}</div>` +
                `<div style="font-weight:700;font-size:13px;margin-bottom:2px">#${s.sequence} · ${s.storeCode}</div>` +
                `<div style="font-size:13px;margin-bottom:4px">${s.storeName}</div>` +
                (s.address ? `<div style="font-size:11px;color:#64748b;margin-bottom:6px;line-height:1.3">${s.address}</div>` : '') +
                `<div style="display:flex;gap:8px;align-items:center;font-size:11px">` +
                  (s.status ? `<span style="display:inline-block;padding:2px 6px;background:${color};color:white;border-radius:3px;font-weight:600">${STATUS_LABEL_ES[s.status]}</span>` : '') +
                  (eta ? `<span style="color:#15803d;font-weight:600">ETA ${eta}</span>` : `<span style="color:#94a3b8;font-style:italic">sin ETA</span>`) +
                `</div>` +
                `<a href="/routes/${r.routeId}" style="display:inline-block;margin-top:8px;padding:5px 10px;background:#15803d;color:white;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600">Ver ruta →</a>` +
              `</div>`;
            new mapboxgl.Marker({ element: el, anchor: 'center' })
              .setLngLat([s.lng, s.lat])
              .setPopup(new mapboxgl.Popup({ offset: 14, maxWidth: '300px' }).setHTML(popupHTML))
              .addTo(map);
          }

          // Polyline real desde Directions API.
          try {
            const res = await fetch(`/api/routes/${r.routeId}/polyline`);
            const data = (await res.json()) as { geometry?: GeoJSON.LineString | null };
            const sourceId = `route-${r.routeId}`;

            // Si no hay geometry (Mapbox falló o sin token), línea recta entre paradas.
            const geometry: GeoJSON.LineString =
              data.geometry ?? buildFallbackLine(r);
            if (geometry.coordinates.length < 2) return;

            map.addSource(sourceId, {
              type: 'geojson',
              data: { type: 'Feature', properties: { routeId: r.routeId }, geometry },
            });
            map.addLayer({
              id: sourceId,
              type: 'line',
              source: sourceId,
              paint: {
                'line-color': color,
                'line-width': 4,
                'line-opacity': 0.8,
                ...(data.geometry ? {} : { 'line-dasharray': [2, 2] }),
              },
              layout: { 'line-cap': 'round', 'line-join': 'round' },
            });
          } catch (err) {
            console.error('[multi-route-map.fetch]', err);
          }
        }),
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [routes, mapboxToken, colorByRoute]);

  // Resaltar/atenuar layers cuando se hace click en la leyenda.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;
    for (const r of routes) {
      const layerId = `route-${r.routeId}`;
      if (!map.getLayer(layerId)) continue;
      const opacity =
        highlightedId == null ? 0.8 : highlightedId === r.routeId ? 1.0 : 0.15;
      map.setPaintProperty(layerId, 'line-opacity', opacity);
    }
  }, [highlightedId, routes]);

  if (!mapboxToken) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-sm text-[var(--color-text-muted)]">
        Mapa deshabilitado: configura <code className="mx-1">NEXT_PUBLIC_MAPBOX_TOKEN</code>.
      </div>
    );
  }

  if (routes.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-sm text-[var(--color-text-muted)]">
        Sin rutas para mostrar en el mapa.
      </div>
    );
  }

  return (
    <div className={`grid gap-3 lg:grid-cols-[1fr_240px] ${className ?? ''}`}>
      <div
        ref={containerRef}
        className="h-[500px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
      />

      {/* Leyenda */}
      <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3">
        <p className="mb-2 text-xs font-semibold text-[var(--color-text-muted)]">
          {routes.length} ruta(s)
        </p>
        <ul className="flex flex-col gap-1">
          {routes.map((r) => {
            const color = colorByRoute.get(r.routeId)!;
            const isActive = highlightedId === r.routeId;
            return (
              <li key={r.routeId}>
                <button
                  type="button"
                  onMouseEnter={() => setHighlightedId(r.routeId)}
                  onMouseLeave={() => setHighlightedId(null)}
                  className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-xs transition-colors ${
                    isActive
                      ? 'bg-[var(--vf-surface-2)]'
                      : 'hover:bg-[var(--vf-surface-2)]'
                  }`}
                >
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{ background: color }}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    <strong className="block truncate text-[var(--color-text)]">
                      {r.routeName}
                    </strong>
                    <span className="block truncate text-[var(--color-text-muted)]">
                      {r.vehicleLabel} · {r.stops.length} paradas
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function buildFallbackLine(r: MultiRouteEntry): GeoJSON.LineString {
  const coords: Array<[number, number]> = [];
  if (r.depot) coords.push([r.depot.lng, r.depot.lat]);
  const sorted = [...r.stops].sort((a, b) => a.sequence - b.sequence);
  for (const s of sorted) coords.push([s.lng, s.lat]);
  if (r.depot) coords.push([r.depot.lng, r.depot.lat]);
  return { type: 'LineString', coordinates: coords };
}
