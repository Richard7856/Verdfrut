// Vista imprimible de un TIRO completo — una hoja por camioneta + portada con
// resumen del tiro al inicio. Cada hoja se separa con page-break-after: always
// (en globals.css) para que el PDF tenga una camioneta por página.
//
// URL: /print/dispatches/[id]. Click "📄 PDF" en /dispatches/[id] lo abre en
// nueva pestaña, el usuario hace Cmd/Ctrl+P → "Guardar como PDF".

import { notFound } from 'next/navigation';
import { getDispatch, listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoutes } from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { getUserProfilesByIds } from '@/lib/queries/users';
import { listDepots } from '@/lib/queries/depots';
import { listZones } from '@/lib/queries/zones';
import { VehicleLoadSheet } from '../../vehicle-load-sheet';

const TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PrintDispatchPage({ params }: PageProps) {
  const { id } = await params;
  const dispatch = await getDispatch(id);
  if (!dispatch) notFound();

  const [routes, zones, vehicles, drivers, depots] = await Promise.all([
    listRoutesByDispatch(id),
    listZones(),
    listVehicles({}),
    listDrivers({}),
    listDepots(),
  ]);

  // Filtrar rutas canceladas — no se cargan, no van al almacenista.
  const liveRoutes = routes.filter((r) => r.status !== 'CANCELLED');

  const stopsByRouteId = await listStopsForRoutes(liveRoutes.map((r) => r.id));
  const allStoreIds = new Set<string>();
  for (const list of stopsByRouteId.values()) {
    for (const s of list) allStoreIds.add(s.storeId);
  }
  const stores = await getStoresByIds([...allStoreIds]);
  const storesById = new Map(stores.map((s) => [s.id, s]));

  // Hidratar profiles de los choferes asignados a estas rutas.
  const driverUserIds = drivers
    .filter((d) => liveRoutes.some((r) => r.driverId === d.id))
    .map((d) => d.userId);
  const profilesByUserId =
    driverUserIds.length > 0 ? await getUserProfilesByIds(driverUserIds) : new Map();
  const driversById = new Map(drivers.map((d) => [d.id, d]));

  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));
  const depotsById = new Map(depots.map((d) => [d.id, d]));
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const generatedAt = new Date();
  const zone = zonesById.get(dispatch.zoneId);

  const fmtDateLong = (yyyymmdd: string): string => {
    const [y, m, d] = yyyymmdd.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return new Intl.DateTimeFormat('es-MX', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  };

  // Totales agregados del tiro — útiles en la portada.
  let totalStops = 0;
  let totalKg = 0;
  for (const r of liveRoutes) {
    const stops = stopsByRouteId.get(r.id) ?? [];
    totalStops += stops.length;
    for (const s of stops) totalKg += Number(s.load?.[0] ?? 0) || 0;
  }

  return (
    <>
      {/* Portada del tiro */}
      <article className="print-cover">
        <h1 className="print-cover-title">Tiro {fmtDateLong(dispatch.date)}</h1>
        <p className="print-cover-subtitle">
          {zone ? `${zone.code} · ${zone.name}` : '—'} ·{' '}
          {liveRoutes.length} camioneta(s) · {totalStops} parada(s)
          {totalKg > 0 ? ` · ${totalKg} kg / cajas` : ''}
        </p>
        <table className="print-cover-table">
          <thead>
            <tr>
              <th>Camioneta</th>
              <th>Chofer</th>
              <th className="print-col-num">Paradas</th>
              <th className="print-col-num">Kg/cajas</th>
              <th>Sale de</th>
            </tr>
          </thead>
          <tbody>
            {liveRoutes.map((r) => {
              const v = vehiclesById.get(r.vehicleId);
              const driver = r.driverId ? driversById.get(r.driverId) : null;
              const profile = driver ? profilesByUserId.get(driver.userId) : null;
              const stops = stopsByRouteId.get(r.id) ?? [];
              const kg = stops.reduce((sum, s) => sum + (Number(s.load?.[0] ?? 0) || 0), 0);
              const depotId = r.depotOverrideId ?? v?.depotId ?? null;
              const depot = depotId ? depotsById.get(depotId) : null;
              return (
                <tr key={r.id}>
                  <td>{v?.alias ? `${v.alias} · ${v.plate}` : (v?.plate ?? '—')}</td>
                  <td>{profile?.fullName ?? 'Sin asignar'}</td>
                  <td className="print-col-num">{stops.length}</td>
                  <td className="print-col-num">{kg > 0 ? kg : '—'}</td>
                  <td>{depot ? depot.code : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </article>

      {/* Una hoja por camioneta */}
      {liveRoutes.map((r) => {
        const v = vehiclesById.get(r.vehicleId);
        const driver = r.driverId ? driversById.get(r.driverId) : null;
        const profile = driver ? profilesByUserId.get(driver.userId) : null;
        const depotId = r.depotOverrideId ?? v?.depotId ?? null;
        const depot = depotId ? depotsById.get(depotId) ?? null : null;
        const zoneRecord = zonesById.get(r.zoneId);
        return (
          <VehicleLoadSheet
            key={r.id}
            route={r}
            stops={stopsByRouteId.get(r.id) ?? []}
            storesById={storesById}
            vehicle={v}
            driverName={profile?.fullName ?? null}
            depot={depot}
            zone={zoneRecord ? { code: zoneRecord.code, name: zoneRecord.name } : null}
            generatedAt={generatedAt}
            timezone={TZ}
          />
        );
      })}
    </>
  );
}
