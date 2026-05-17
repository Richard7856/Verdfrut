// Mapa en vivo — supervisión de choferes en ruta.
// Server component: carga rutas activas (PUBLISHED/IN_PROGRESS/COMPLETED) hoy +
// driver/vehicle joins + último breadcrumb por ruta para la posición actual del
// chofer en el mapa.
//
// ADR-054 (Sprint H4): refactor de N+1 a queries batch. Antes hacíamos
// `Promise.all(routes.map(async r => { listStops + breadcrumb + profile }))` →
// 3×N queries por render. Ahora 4 queries totales (listStopsForRoutes,
// getLastBreadcrumbsByRouteIds, getUserProfilesByIds + iniciales en paralelo).
// Mejora ~10× con >5 rutas activas (cuello eran RTTs por ruta).

import { requireRole } from '@/lib/auth';
import { listRoutes } from '@/lib/queries/routes';
import { listDrivers } from '@/lib/queries/drivers';
import { listVehicles } from '@/lib/queries/vehicles';
import { listStores } from '@/lib/queries/stores';
import { listStopsForRoutes } from '@/lib/queries/stops';
import { listZones } from '@/lib/queries/zones';
import { getUserProfilesByIds } from '@/lib/queries/users';
import { getLastBreadcrumbsByRouteIds } from '@/lib/queries/breadcrumbs';
import { todayInZone } from '@tripdrive/utils';
import { LiveMapClient } from './live-map-client';
import type { LiveDriver } from './live-map-client';

export const metadata = { title: 'Mapa en vivo' };
export const dynamic = 'force-dynamic';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

export default async function MapPage() {
  // ADR-124: zone_manager también puede ver el mapa live (read-only).
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');
  const today = todayInZone(TZ);

  const [routesData, drivers, vehicles, stores, zones] = await Promise.all([
    listRoutes({
      date: today,
      status: ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED'],
      limit: 100,
    }),
    listDrivers({ activeOnly: true }),
    listVehicles({ activeOnly: false }),
    listStores({ activeOnly: false }),
    listZones(),
  ]);

  const routes = routesData.rows;
  const routeIds = routes.map((r) => r.id);

  // H4.1: 3 queries batch en paralelo (en vez de 3×N secuenciales).
  // Resolvemos user_ids de los choferes ANTES de pedir profiles porque los
  // profile ids son user_ids (auth.users.id), no driver.id.
  const driverUserIds = routes
    .map((r) => drivers.find((d) => d.id === r.driverId)?.userId)
    .filter((id): id is string => Boolean(id));

  const [stopsByRouteId, lastPosByRouteId, profilesByUserId] = await Promise.all([
    listStopsForRoutes(routeIds),
    getLastBreadcrumbsByRouteIds(routeIds),
    getUserProfilesByIds(Array.from(new Set(driverUserIds))),
  ]);

  const enriched: LiveDriver[] = routes.map((r) => {
    const stops = stopsByRouteId.get(r.id) ?? [];
    const totalStops = stops.length;
    const completedStops = stops.filter(
      (s) => s.status === 'completed' || s.status === 'skipped',
    ).length;
    const nextStop = stops.find((s) => s.status === 'pending') ?? null;

    const driver = drivers.find((d) => d.id === r.driverId);
    const vehicle = vehicles.find((v) => v.id === r.vehicleId);
    const driverProfile = driver ? profilesByUserId.get(driver.userId) ?? null : null;
    const lastPos = lastPosByRouteId.get(r.id) ?? null;

    return {
      routeId: r.id,
      routeName: r.name,
      routeStatus: r.status,
      driverId: driver?.id ?? null,
      driverName: driverProfile?.fullName ?? '— Sin chofer —',
      driverInitials: (driverProfile?.fullName ?? '?')
        .split(' ')
        .filter(Boolean)
        .slice(0, 2)
        .map((p) => p[0])
        .join('')
        .toUpperCase(),
      vehiclePlate: vehicle?.plate ?? '—',
      vehicleAlias: vehicle?.alias ?? null,
      zoneId: r.zoneId,
      zoneName: zones.find((z) => z.id === r.zoneId)?.name ?? '—',
      totalStops,
      completedStops,
      nextStop: nextStop
        ? {
            storeName: stores.find((s) => s.id === nextStop.storeId)?.name ?? '—',
            storeCode: stores.find((s) => s.id === nextStop.storeId)?.code ?? '—',
            plannedArrivalAt: nextStop.plannedArrivalAt,
            demand: stores.find((s) => s.id === nextStop.storeId)?.demand ?? null,
          }
        : null,
      lastPos,
    };
  });

  return (
    <LiveMapClient
      drivers={enriched}
      mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''}
      viewerName={profile.fullName}
    />
  );
}
