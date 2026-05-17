// ADR-125 / 2026-05-16: pantalla de "primera vez en la ruta" del chofer.
// Cuando el admin publica la ruta y el chofer la abre por primera vez,
// aterriza aquí en lugar de en /route. Ve el mapa con todas las paradas
// numeradas (orden sugerido del optimizer) y elige:
//
//   1. "✓ Usar orden sugerido" → acepta sin cambios, va a /route normal.
//   2. "Definir mi orden" → tappea pines en el orden que prefiera y guarda.
//
// Después de cualquiera de los dos, se setea routes.driver_order_confirmed_at
// y las próximas aperturas de /route van directo a la vista de operación.
//
// Auth: requireDriverProfile() + RLS filtran al chofer correcto.
// Si la ruta no existe, ya fue confirmada, o no está PUBLISHED → redirige a /route.

import { redirect } from 'next/navigation';
import { requireDriverProfile } from '@/lib/auth';
import { getDriverRouteForDate, getRouteStopsWithStores } from '@/lib/queries/route';
import { todayInZone } from '@tripdrive/utils';
import { AcceptRouteFlow } from './accept-route-flow';

export const metadata = { title: 'Confirmar mi orden' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';

export default async function AcceptRoutePage() {
  await requireDriverProfile();
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;
  const today = todayInZone(timezone);

  const route = await getDriverRouteForDate(today);

  // Guards: si no hay ruta, ya está confirmada, o no está en PUBLISHED,
  // este flow no aplica — redirigimos a /route donde el chofer ya tiene
  // su vista normal de paradas.
  if (!route) redirect('/route');
  if (route.driverOrderConfirmedAt !== null) redirect('/route');
  if (route.status !== 'PUBLISHED') redirect('/route');

  const stops = await getRouteStopsWithStores(route.id);

  // Si no hay paradas, también es un caso raro — el chofer no tiene qué
  // ordenar. Confirmar automáticamente sería overkill; mostramos un mensaje.
  if (stops.length === 0) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center bg-[var(--vf-bg)] p-6 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">
          Tu ruta no tiene paradas. Contacta a tu encargado.
        </p>
      </main>
    );
  }

  // Mapbox token público — el mapa renderiza tiles vía este token, expuesto
  // intencionalmente (es URL-restricted en Mapbox dashboard).
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  // Estructuramos el payload para el client: cada parada con su id, info
  // de la tienda y la sequence sugerida (lo que el optimizer/admin propuso).
  // Si suggested_sequence está null (legacy), fall back al sequence operativo
  // — para una ruta recién publicada deberían coincidir tras ADR-125.
  const stopsForMap = stops.map((row) => ({
    stopId: row.stop.id,
    storeCode: row.store.code,
    storeName: row.store.name,
    lat: row.store.lat,
    lng: row.store.lng,
    suggestedSequence: row.stop.suggestedSequence ?? row.stop.sequence,
    currentSequence: row.stop.sequence,
    status: row.stop.status,
  }));

  return (
    <AcceptRouteFlow
      routeName={route.name}
      stops={stopsForMap}
      mapboxToken={mapboxToken}
    />
  );
}
