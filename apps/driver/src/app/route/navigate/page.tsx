// Pantalla de navegación fullscreen. Carga datos server-side, render del
// orquestador es client (necesita GPS + mapa).
//
// Si no hay ruta para hoy, redirige a /route que muestra el empty state.

import { redirect } from 'next/navigation';
import { requireDriverProfile } from '@/lib/auth';
import { getDriverRouteForDate, getRouteStopsWithStores } from '@/lib/queries/route';
import { createServerClient } from '@verdfrut/supabase/server';
import { todayInZone } from '@verdfrut/utils';
import { getMapboxDirections } from '@/lib/mapbox';
import { NavigationClient } from '@/components/navigate/navigation-client';
import type { NavigationStop, NavigationDepot } from '@/components/navigate/navigation-map';

export const metadata = { title: 'Navegación' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';

export default async function NavigatePage() {
  await requireDriverProfile();

  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;
  const today = todayInZone(timezone);
  const route = await getDriverRouteForDate(today);
  if (!route) redirect('/route');

  const stopsWithStores = await getRouteStopsWithStores(route.id);

  // Resolver depot del vehículo: FK a depots o coords manuales.
  const supabase = await createServerClient();
  let depot: NavigationDepot | null = null;
  const { data: vehicleRow } = await supabase
    .from('vehicles')
    .select('depot_id, depot_lat, depot_lng, plate, alias')
    .eq('id', route.vehicleId)
    .maybeSingle();
  if (vehicleRow) {
    if (vehicleRow.depot_id) {
      const { data: depotRow } = await supabase
        .from('depots')
        .select('code, name, lat, lng')
        .eq('id', vehicleRow.depot_id)
        .maybeSingle();
      if (depotRow) {
        depot = {
          code: depotRow.code,
          name: depotRow.name,
          lat: depotRow.lat,
          lng: depotRow.lng,
        };
      }
    } else if (vehicleRow.depot_lat && vehicleRow.depot_lng) {
      depot = {
        code: vehicleRow.plate,
        name: `Salida de ${vehicleRow.alias ?? vehicleRow.plate}`,
        lat: vehicleRow.depot_lat,
        lng: vehicleRow.depot_lng,
      };
    }
  }

  const navStops: NavigationStop[] = stopsWithStores.map((item) => ({
    stopId: item.stop.id,
    storeId: item.store.id,
    storeCode: item.store.code,
    storeName: item.store.name,
    sequence: item.stop.sequence,
    status: item.stop.status,
    lat: item.store.lat,
    lng: item.store.lng,
  }));

  // Cargar polyline server-side (Mapbox Directions). Devuelve null si el
  // token no está configurado o la llamada falla — el cliente cae a líneas
  // rectas. NO depende de un endpoint local del driver app (evitamos 404).
  let geometry: GeoJSON.LineString | null = null;
  if (depot && navStops.length > 0) {
    const sortedStops = [...navStops].sort((a, b) => a.sequence - b.sequence);
    const waypoints: Array<[number, number]> = [
      [depot.lng, depot.lat],
      ...sortedStops.map((s) => [s.lng, s.lat] as [number, number]),
      [depot.lng, depot.lat], // regreso al CEDIS
    ];
    const result = await getMapboxDirections(waypoints);
    if (result) geometry = result.geometry;
  }

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <NavigationClient
      routeId={route.id}
      stops={navStops}
      depot={depot}
      geometry={geometry}
      mapboxToken={mapboxToken}
    />
  );
}
