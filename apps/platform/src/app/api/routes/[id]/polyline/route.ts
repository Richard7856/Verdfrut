// Devuelve la polyline (GeoJSON LineString) de una ruta usando Mapbox Directions API.
// El cliente la pinta encima del mapa. Si MAPBOX_DIRECTIONS_TOKEN no está set
// o falla la llamada, devuelve null y el mapa cae a líneas rectas (fallback).
//
// Por qué endpoint separado en vez de pasarlo via props del Server Component:
// 1. Cachea con Next route handler cache (la ruta no cambia mientras está
//    OPTIMIZED — solo si re-optimizan).
// 2. Mantiene el secret token MAPBOX_DIRECTIONS_TOKEN server-side.
// 3. Permite refrescar el mapa sin recargar todos los datos de la página.

import 'server-only';
import { requireRole } from '@/lib/auth';
import { getRoute } from '@/lib/queries/routes';
import { listStopsForRoute } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDepot } from '@/lib/queries/depots';
import { getMapboxDirections } from '@/lib/mapbox';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const { id } = await params;

  const route = await getRoute(id);
  if (!route) return Response.json({ error: 'Route not found' }, { status: 404 });

  const stops = await listStopsForRoute(id);
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);
  if (sortedStops.length === 0) return Response.json({ geometry: null });

  // Resolver depot — prioridad ADR-047: route.depotOverrideId > vehicle.depot_id > vehicle.depot_lat/lng.
  let depotLng: number | null = null;
  let depotLat: number | null = null;
  if (route.depotOverrideId) {
    const depot = await getDepot(route.depotOverrideId);
    if (depot) {
      depotLng = depot.lng;
      depotLat = depot.lat;
    }
  }
  if (depotLng === null || depotLat === null) {
    const [vehicle] = await getVehiclesByIds([route.vehicleId]);
    if (!vehicle) return Response.json({ geometry: null });
    if (vehicle.depotId) {
      const depot = await getDepot(vehicle.depotId);
      if (!depot) return Response.json({ geometry: null });
      depotLng = depot.lng;
      depotLat = depot.lat;
    } else {
      depotLng = vehicle.depotLng ?? 0;
      depotLat = vehicle.depotLat ?? 0;
    }
  }

  // Resolver coords de cada parada en orden.
  const storeIds = sortedStops.map((s) => s.storeId);
  const stores = await getStoresByIds(storeIds);
  const storesById = new Map(stores.map((s) => [s.id, s]));

  // Waypoints: depot → paradas en orden → depot (regreso).
  const waypoints: Array<[number, number]> = [[depotLng, depotLat]];
  for (const s of sortedStops) {
    const store = storesById.get(s.storeId);
    if (!store) continue;
    waypoints.push([store.lng, store.lat]);
  }
  waypoints.push([depotLng, depotLat]);

  // Mapbox Directions limita 25 waypoints. Para rutas más grandes en el futuro,
  // partir y concatenar geometries.
  if (waypoints.length > 25) {
    return Response.json({
      geometry: null,
      reason: `${waypoints.length} waypoints > 25 — chunking pendiente`,
    });
  }

  try {
    const result = await getMapboxDirections(waypoints);
    if (!result) return Response.json({ geometry: null });
    return Response.json({
      geometry: result.geometry,
      distance: result.distance,
      duration: result.duration,
    }, {
      headers: {
        // Cache 60s. Antes era 5 min pero al permitir cambiar depot/orden de paradas
        // desde el detalle del tiro (ADR-047, ADR-048), cache largo dejaba el
        // polyline anterior pintado encima del nuevo. 60s da hit-rate suficiente
        // para navegación normal sin atrapar cambios del dispatcher.
        'Cache-Control': 'private, max-age=60',
      },
    });
  } catch (err) {
    console.error('[polyline] error:', err);
    return Response.json({ geometry: null });
  }
}
