// Mapa en vivo — supervisión de choferes en ruta.
// Server component: carga rutas activas (PUBLISHED/IN_PROGRESS) hoy + driver/vehicle joins
// + último breadcrumb por ruta para la posición actual del chofer en el mapa.

import { requireRole } from '@/lib/auth';
import { listRoutes } from '@/lib/queries/routes';
import { listDrivers } from '@/lib/queries/drivers';
import { listVehicles } from '@/lib/queries/vehicles';
import { listStores } from '@/lib/queries/stores';
import { listStopsForRoute } from '@/lib/queries/stops';
import { listZones } from '@/lib/queries/zones';
import { createServerClient } from '@verdfrut/supabase/server';
import { todayInZone } from '@verdfrut/utils';
import type { UserProfile } from '@verdfrut/types';
import { LiveMapClient } from './live-map-client';
import type { LiveDriver } from './live-map-client';

export const metadata = { title: 'Mapa en vivo' };
export const dynamic = 'force-dynamic';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

export default async function MapPage() {
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

  // Para cada ruta cargamos: stops + último breadcrumb (posición actual).
  const supabase = await createServerClient();
  const enriched = await Promise.all(
    routes.map(async (r) => {
      const stops = await listStopsForRoute(r.id);
      const totalStops = stops.length;
      const completedStops = stops.filter(
        (s) => s.status === 'completed' || s.status === 'skipped',
      ).length;
      const nextStop = stops.find((s) => s.status === 'pending') ?? null;

      // Último breadcrumb publicado (mejor proxy de ubicación actual).
      let lastPos: { lat: number; lng: number; recordedAt: string } | null = null;
      const { data: bc } = await supabase
        .from('route_breadcrumbs')
        .select('lat, lng, recorded_at')
        .eq('route_id', r.id)
        .order('recorded_at', { ascending: false })
        .limit(1);
      if (bc && bc[0]) {
        lastPos = {
          lat: bc[0].lat as number,
          lng: bc[0].lng as number,
          recordedAt: bc[0].recorded_at as string,
        };
      }

      const driver = drivers.find((d) => d.id === r.driverId);
      const vehicle = vehicles.find((v) => v.id === r.vehicleId);
      let driverProfile: UserProfile | null = null;
      if (driver) {
        const { data: profileRow } = await supabase
          .from('user_profiles')
          .select('id, email, full_name, role, zone_id, phone, is_active, must_reset_password, created_at')
          .eq('id', driver.userId)
          .maybeSingle();
        if (profileRow) {
          driverProfile = {
            id: profileRow.id as string,
            email: profileRow.email as string,
            fullName: profileRow.full_name as string,
            role: profileRow.role as UserProfile['role'],
            zoneId: profileRow.zone_id as string | null,
            phone: profileRow.phone as string | null,
            isActive: profileRow.is_active as boolean,
            mustResetPassword: profileRow.must_reset_password as boolean,
            createdAt: profileRow.created_at as string,
          };
        }
      }

      const liveDriver: LiveDriver = {
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
      return liveDriver;
    }),
  );

  return (
    <LiveMapClient
      drivers={enriched}
      mapboxToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ''}
      viewerName={profile.fullName}
    />
  );
}
