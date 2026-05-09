'use client';

// Wrapper cliente del RouteMap que carga la polyline desde /api/routes/[id]/polyline.
// Mientras carga muestra el mapa con líneas rectas (instant feedback); cuando
// llega la geometría real, refresca el mapa.

import { useEffect, useState } from 'react';
import { RouteMap, type RouteMapStop, type RouteMapDepot } from './route-map';

interface Props {
  routeId: string;
  stops: RouteMapStop[];
  depot: RouteMapDepot | null;
  mapboxToken: string;
  /**
   * Cache-buster (ej. `route.updatedAt`) — cuando cambia depot/orden de paradas,
   * el server pasa el nuevo timestamp y el fetch va al browser fresco en vez de
   * devolver el polyline cacheado anterior.
   */
  cacheKey?: string;
}

export function RouteMapLoader({ routeId, stops, depot, mapboxToken, cacheKey }: Props) {
  const [geometry, setGeometry] = useState<GeoJSON.LineString | null>(null);

  useEffect(() => {
    if (!mapboxToken) return;
    let cancelled = false;
    // Limpiar el polyline cacheado en el state si la cacheKey cambia — evita
    // pintar la línea anterior mientras llega el fetch nuevo.
    setGeometry(null);
    const url = cacheKey
      ? `/api/routes/${routeId}/polyline?v=${encodeURIComponent(cacheKey)}`
      : `/api/routes/${routeId}/polyline`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { geometry?: GeoJSON.LineString | null } | null) => {
        if (cancelled) return;
        if (data?.geometry) setGeometry(data.geometry);
      })
      .catch((err) => console.error('[polyline.fetch]', err));
    return () => {
      cancelled = true;
    };
  }, [routeId, mapboxToken, cacheKey]);

  if (!mapboxToken) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] text-sm text-[var(--color-text-muted)]">
        Mapa deshabilitado: configura <code className="mx-1">NEXT_PUBLIC_MAPBOX_TOKEN</code> en .env.local
      </div>
    );
  }

  return (
    <div className="h-[500px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
      <RouteMap stops={stops} depot={depot} geometry={geometry} mapboxToken={mapboxToken} />
    </div>
  );
}
