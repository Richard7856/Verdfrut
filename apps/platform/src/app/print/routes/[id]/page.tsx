// Vista imprimible de UNA ruta — layout de su camioneta.
// URL: /print/routes/[id]. El usuario llega aquí desde el botón "📄 PDF" en
// /routes/[id]. La página renderiza la hoja y la print-toolbar.tsx ofrece el
// trigger window.print() para abrir el diálogo del navegador.

import { notFound } from 'next/navigation';
import { getRoute } from '@/lib/queries/routes';
import { listStopsForRoute } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDriversByIds } from '@/lib/queries/drivers';
import { getUserProfile } from '@/lib/queries/users';
import { getDepot } from '@/lib/queries/depots';
import { listZones } from '@/lib/queries/zones';
import { VehicleLoadSheet } from '../../vehicle-load-sheet';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PrintRoutePage({ params }: PageProps) {
  const { id } = await params;
  const route = await getRoute(id);
  if (!route) notFound();

  const [stops, zones] = await Promise.all([listStopsForRoute(id), listZones()]);
  const [stores, vehicles, driverRows] = await Promise.all([
    getStoresByIds(stops.map((s) => s.storeId)),
    getVehiclesByIds([route.vehicleId]),
    route.driverId ? getDriversByIds([route.driverId]) : Promise.resolve([]),
  ]);

  const vehicle = vehicles[0];
  const driverRow = driverRows[0];
  const driverProfile = driverRow ? await getUserProfile(driverRow.userId) : null;
  const driverName = driverProfile?.fullName ?? null;

  // Resolver depot — ADR-047: override de ruta tiene prioridad sobre el del vehículo.
  let depot = null;
  if (route.depotOverrideId) {
    depot = await getDepot(route.depotOverrideId);
  }
  if (!depot && vehicle?.depotId) {
    depot = await getDepot(vehicle.depotId);
  }

  const storesById = new Map(stores.map((s) => [s.id, s]));
  const zoneRecord = zones.find((z) => z.id === route.zoneId);
  const zone = zoneRecord ? { code: zoneRecord.code, name: zoneRecord.name } : null;

  return (
    <VehicleLoadSheet
      route={route}
      stops={stops}
      storesById={storesById}
      vehicle={vehicle}
      driverName={driverName}
      depot={depot}
      zone={zone}
      generatedAt={new Date()}
      timezone={TZ}
    />
  );
}
