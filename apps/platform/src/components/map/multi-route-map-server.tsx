// Server Component que prepara los datos para <MultiRouteMap>:
// para cada ruta, carga sus stops + tiendas + depot.
//
// Hace una pasada eficiente:
//   - Stops: un solo IN (...) sobre routeIds
//   - Stores: un solo IN (...) sobre storeIds únicos
//   - Depots: un solo SELECT por zoneId común (la mayoría de rutas comparten)
//   - Vehicles: un solo IN (...)

import 'server-only';
import type { Route } from '@tripdrive/types';
import { listStopsForRoutes } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { listDepots } from '@/lib/queries/depots';
import { MultiRouteMap, type MultiRouteEntry } from './multi-route-map';
import { BulkSelectableMultiRouteMap } from './bulk-selectable-multi-route-map';

interface Props {
  routes: Route[];
  mapboxToken: string;
  /**
   * Si está definido, el mapa habilita "Modo Selección" con toolbar flotante
   * para acciones bulk (mover stops entre rutas). El scope decide qué path
   * revalidar tras un move y cómo manejar cross-dispatch:
   *   - `dispatch` (legacy /dispatches/[id]): todas las rutas del mismo tiro
   *   - `day` (UX-Fase 2 /dia/[fecha]): rutas pueden venir de distintos
   *     dispatches, los moves cruzan, action revalida todos los afectados
   * Si no se pasa scope, el mapa renderiza solo-lectura.
   *
   * ADR-121 Fase 1: el caller decide pasar `scope` solo si el plan tiene la
   * feature `dragEditMap`. Esto degrada graciosamente a mapa read-only en
   * Starter, sin esconder el mapa completo.
   */
  scope?:
    | { type: 'dispatch'; dispatchId: string }
    | { type: 'day'; fecha: string };
}

export async function MultiRouteMapServer({ routes, mapboxToken, scope }: Props) {
  if (routes.length === 0) return null;

  // H4.1 / ADR-054: una sola query batch para todas las stops vía
  // `listStopsForRoutes(ids[])` en vez del N+1 anterior `Promise.all(routes.map(listStopsForRoute))`.
  // Mejora ~5× en tiros con 5+ rutas (cuello era RTT por ruta).
  const routeIds = routes.map((r) => r.id);
  const [vehicleArrays, depotsAll, stopsByRouteId] = await Promise.all([
    getVehiclesByIds(routes.map((r) => r.vehicleId)),
    listDepots(), // todos los depots — usualmente <10
    listStopsForRoutes(routeIds),
  ]);
  const stopsArrays = routes.map((r) => stopsByRouteId.get(r.id) ?? []);
  const vehiclesById = new Map(vehicleArrays.map((v) => [v.id, v]));
  const depotsById = new Map(depotsAll.map((d) => [d.id, d]));

  // Reunir todos los storeIds para un solo fetch.
  const storeIds = Array.from(
    new Set(stopsArrays.flat().map((s) => s.storeId)),
  );
  const stores = await getStoresByIds(storeIds);
  const storesById = new Map(stores.map((s) => [s.id, s]));

  const entries: MultiRouteEntry[] = routes.map((r, idx) => {
    const vehicle = vehiclesById.get(r.vehicleId);
    const stops = stopsArrays[idx] ?? [];

    // Resolución de depot — ADR-047: prioridad route.depotOverrideId > vehicle.
    let depot: MultiRouteEntry['depot'] = null;
    if (r.depotOverrideId) {
      const d = depotsById.get(r.depotOverrideId);
      if (d) depot = { code: d.code, name: d.name, lat: d.lat, lng: d.lng };
    }
    if (!depot && vehicle?.depotId) {
      const d = depotsById.get(vehicle.depotId);
      if (d) depot = { code: d.code, name: d.name, lat: d.lat, lng: d.lng };
    }
    if (!depot && vehicle?.depotLat && vehicle?.depotLng) {
      depot = {
        code: vehicle.plate,
        name: `Salida de ${vehicle.alias ?? vehicle.plate}`,
        lat: vehicle.depotLat,
        lng: vehicle.depotLng,
      };
    }

    return {
      routeId: r.id,
      routeName: r.name,
      vehicleLabel: vehicle ? (vehicle.alias ?? vehicle.plate) : '—',
      vehicleColorAlias: vehicle?.alias ?? null,
      stops: stops
        .map((s) => {
          const store = storesById.get(s.storeId);
          if (!store) return null;
          return {
            stopId: s.id,
            storeCode: store.code,
            storeName: store.name,
            sequence: s.sequence,
            lat: store.lat,
            lng: store.lng,
            // ADR-039: extra contexto para popup mejorado del marker.
            address: store.address,
            plannedArrivalAt: s.plannedArrivalAt,
            status: s.status,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
      depot,
      // Cache-buster: cambia con cualquier UPDATE a la ruta (depot override,
      // métricas, ETAs). Asegura que el browser no muestre el polyline anterior.
      cacheKey: r.updatedAt,
    };
  });

  // Si el caller pasa scope, habilitamos el wrapper de selección bulk.
  // Sin scope, mapa solo-lectura (uso default desde /live, embeddings, etc).
  if (scope) {
    return (
      <BulkSelectableMultiRouteMap
        routes={entries}
        mapboxToken={mapboxToken}
        scope={scope}
      />
    );
  }
  return <MultiRouteMap routes={entries} mapboxToken={mapboxToken} />;
}
