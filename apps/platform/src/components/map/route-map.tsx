'use client';

// Mapa Mapbox con la ruta optimizada: depot, paradas numeradas, polyline.
//
// Estrategia de render:
//   1. Inicializar Mapbox GL JS con bbox que cubra todos los puntos.
//   2. Pintar marker numerado para cada parada en orden de visita.
//   3. Pintar marker distinto (cuadrado) para el depot.
//   4. Si hay polyline (geometry de Directions API), pintarla; si no,
//      conectar puntos con líneas rectas como fallback visual.
//
// Sólo se renderiza en cliente (Mapbox GL JS requiere DOM). El servidor
// pasa los datos via props.

import { useEffect, useRef } from 'react';
import { mapboxgl, setMapboxToken } from '@verdfrut/maps';

export interface RouteMapStop {
  storeId: string;
  storeCode: string;
  storeName: string;
  sequence: number;
  lat: number;
  lng: number;
  status: 'pending' | 'arrived' | 'completed' | 'skipped';
  /** ADR-039: dirección de la tienda — popup la muestra para contexto operativo. */
  address?: string | null;
  /** ADR-039: ETA planeada del optimizer; si null/undefined, popup muestra "sin ETA". */
  plannedArrivalAt?: string | null;
}

export interface RouteMapDepot {
  code: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  stops: RouteMapStop[];
  depot: RouteMapDepot | null;
  /** GeoJSON LineString de la ruta real (Directions API). Null = líneas rectas. */
  geometry: GeoJSON.LineString | null;
  /** Token público de Mapbox (NEXT_PUBLIC_MAPBOX_TOKEN). */
  mapboxToken: string;
  /** ADR-039: si viene, popup del marker incluye CTA "Ver detalle" → /routes/[routeId]. */
  routeId?: string;
  /** Timezone para formatear ETA. Default America/Mexico_City. */
  timezone?: string;
  className?: string;
}

const STATUS_COLORS: Record<RouteMapStop['status'], string> = {
  pending: '#94a3b8',     // gris
  arrived: '#3b82f6',     // azul
  completed: '#16a34a',   // verde
  skipped: '#dc2626',     // rojo
};

const STATUS_LABEL: Record<RouteMapStop['status'], string> = {
  pending: 'Pendiente',
  arrived: 'En sitio',
  completed: 'Completada',
  skipped: 'Omitida',
};

/**
 * ADR-039: HTML del popup del marker. Antes era 3 líneas (#sequence, name, status).
 * Ahora incluye dirección, ETA con color según status, label en español, y opcionalmente
 * CTA al detalle de la ruta. Diseñado para que el dispatcher tome decisiones desde el mapa.
 *
 * Inline styles porque Mapbox popup vive fuera del React tree y NO tiene acceso a
 * tokens del tema. El bg del popup es siempre blanco (Mapbox built-in), por eso
 * los colores son hardcoded — son legibles en cualquier theme de la app.
 */
function buildStopPopupHTML(
  s: RouteMapStop,
  routeId: string | undefined,
  timezone: string,
): string {
  const eta = s.plannedArrivalAt
    ? new Intl.DateTimeFormat('es-MX', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(s.plannedArrivalAt))
    : null;
  const statusColor = STATUS_COLORS[s.status];
  const cta = routeId
    ? `<a href="/routes/${routeId}" style="display:inline-block;margin-top:8px;padding:5px 10px;background:#15803d;color:white;border-radius:4px;text-decoration:none;font-size:11px;font-weight:600">Ver ruta →</a>`
    : '';
  return (
    `<div style="font-family:ui-sans-serif;color:#0f172a;min-width:200px;max-width:260px">` +
      `<div style="font-weight:700;font-size:13px;margin-bottom:2px">#${s.sequence} · ${s.storeCode}</div>` +
      `<div style="font-size:13px;margin-bottom:4px">${s.storeName}</div>` +
      (s.address ? `<div style="font-size:11px;color:#64748b;margin-bottom:6px;line-height:1.3">${s.address}</div>` : '') +
      `<div style="display:flex;gap:8px;align-items:center;font-size:11px">` +
        `<span style="display:inline-block;padding:2px 6px;background:${statusColor};color:white;border-radius:3px;font-weight:600">${STATUS_LABEL[s.status]}</span>` +
        (eta ? `<span style="color:#15803d;font-weight:600">ETA ${eta}</span>` : `<span style="color:#94a3b8;font-style:italic">sin ETA</span>`) +
      `</div>` +
      cta +
    `</div>`
  );
}

export function RouteMap({ stops, depot, geometry, mapboxToken, routeId, timezone, className }: Props) {
  const tz = timezone ?? 'America/Mexico_City';
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!mapboxToken) {
      console.error('[RouteMap] mapboxToken vacío — el mapa no se va a renderizar.');
      return;
    }

    setMapboxToken(mapboxToken);

    // Calcular bbox que cubra depot + todas las paradas.
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

    // Sumar marcadores cuando el estilo termine de cargar.
    map.on('load', () => {
      // Depot — cuadrado oscuro.
      if (depot) {
        const el = document.createElement('div');
        el.style.cssText =
          'width:18px;height:18px;background:#0f172a;border:2px solid white;' +
          'border-radius:3px;box-shadow:0 1px 2px rgba(0,0,0,0.3);';
        new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([depot.lng, depot.lat])
          .setPopup(new mapboxgl.Popup({ offset: 12 }).setHTML(
            `<div style="font-family:ui-sans-serif;color:#0f172a"><strong>${depot.code}</strong><br/>${depot.name}<br/><em>CEDIS / Hub</em></div>`,
          ))
          .addTo(map);
      }

      // Stops — círculos numerados por sequence con color según status.
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
          .setPopup(
            new mapboxgl.Popup({ offset: 16, maxWidth: '280px' }).setHTML(
              buildStopPopupHTML(s, routeId, tz),
            ),
          )
          .addTo(map);
      }

      // Polyline.
      const lineGeometry: GeoJSON.LineString = geometry ?? buildFallbackLine(depot, stops);
      if (lineGeometry.coordinates.length >= 2) {
        map.addSource('route-line', {
          type: 'geojson',
          data: { type: 'Feature', properties: {}, geometry: lineGeometry },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route-line',
          paint: {
            'line-color': '#16a34a',
            'line-width': 4,
            'line-opacity': 0.85,
            // Si NO hay geometry real, marcamos visualmente que es fallback.
            ...(geometry ? {} : { 'line-dasharray': [2, 2] }),
          },
          layout: {
            'line-cap': 'round',
            'line-join': 'round',
          },
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // Re-render cuando cambian los datos. Mapbox no permite mutar markers en vivo
    // sin manejar refs — por simplicidad recreamos el mapa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stops, depot, geometry, mapboxToken]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', minHeight: 400 }}
    />
  );
}

/**
 * Línea recta depot → stops en orden → depot. Solo cuando no tenemos
 * geometry real de Mapbox Directions. Visualmente queda dasharray.
 */
function buildFallbackLine(
  depot: RouteMapDepot | null,
  stops: RouteMapStop[],
): GeoJSON.LineString {
  const coords: Array<[number, number]> = [];
  if (depot) coords.push([depot.lng, depot.lat]);
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  for (const s of sorted) coords.push([s.lng, s.lat]);
  if (depot) coords.push([depot.lng, depot.lat]);
  return { type: 'LineString', coordinates: coords };
}
