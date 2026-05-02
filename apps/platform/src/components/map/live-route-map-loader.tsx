'use client';

// Wrapper cliente del LiveRouteMap que carga la polyline (Mapbox Directions)
// vía /api/routes/[id]/polyline y la pasa al mapa en vivo.

import { useEffect, useState } from 'react';
import { LiveRouteMap } from './live-route-map';
import type { RouteMapStop, RouteMapDepot } from './route-map';

interface Props {
  routeId: string;
  stops: RouteMapStop[];
  depot: RouteMapDepot | null;
  mapboxToken: string;
  driverName?: string;
}

export function LiveRouteMapLoader({ routeId, stops, depot, mapboxToken, driverName }: Props) {
  const [geometry, setGeometry] = useState<GeoJSON.LineString | null>(null);

  useEffect(() => {
    if (!mapboxToken) return;
    let cancelled = false;
    fetch(`/api/routes/${routeId}/polyline`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { geometry?: GeoJSON.LineString | null } | null) => {
        if (cancelled) return;
        if (data?.geometry) setGeometry(data.geometry);
      })
      .catch((err) => console.error('[live-polyline.fetch]', err));
    return () => {
      cancelled = true;
    };
  }, [routeId, mapboxToken]);

  return (
    <LiveRouteMap
      routeId={routeId}
      stops={stops}
      depot={depot}
      geometry={geometry}
      mapboxToken={mapboxToken}
      driverName={driverName}
    />
  );
}
