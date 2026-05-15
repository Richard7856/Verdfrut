// Visual dispatch builder — arma un tiro nuevo visualmente desde el mapa.
// Stream Phase 4 (2026-05-15 noche).
//
// Flow:
//   1. User elige zona en /dispatches/page.tsx → llega aquí con ?zone=<uuid>
//   2. Server carga: todas las stores activas de la zona, vehículos activos,
//      choferes activos de la zona.
//   3. Cliente muestra mapa con todas las stores como pines grises +
//      sidebar con tabs "Camionetas" (vacía) + "Sin asignar" (lista filtrable).
//   4. User selecciona stops (click + Shift+drag) y los asigna a camionetas
//      que va agregando al sidebar.
//   5. Botón "Crear tiro" persiste todo en transacción.

import { redirect } from 'next/navigation';
import { PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listStores } from '@/lib/queries/stores';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { listZones } from '@/lib/queries/zones';
import { listDepots } from '@/lib/queries/depots';
import { VisualDispatchBuilder } from './visual-builder-client';

export const metadata = { title: 'Armar tiro visualmente' };
export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PageProps {
  searchParams: Promise<{ zone?: string }>;
}

export default async function VisualDispatchPage({ searchParams }: PageProps) {
  await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const zoneId = params.zone;

  const zones = await listZones();

  // Sin zona en query → selector inicial.
  if (!zoneId || !UUID_RE.test(zoneId)) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="Armar tiro visualmente"
          description="Elige primero la zona — el sistema te mostrará el mapa con todas sus tiendas para que armes las rutas."
        />
        <div className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-6">
          <h3 className="mb-3 text-sm font-semibold">Selecciona zona</h3>
          {zones.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              No hay zonas configuradas. Crea una en{' '}
              <a href="/settings/zones" className="text-emerald-400 underline">
                /settings/zones
              </a>
              .
            </p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {zones.map((z) => (
                <li key={z.id}>
                  <a
                    href={`/dispatches/new/visual?zone=${z.id}`}
                    className="inline-flex items-center gap-2 rounded-md border border-[var(--vf-line)] bg-[var(--vf-bg-elev)] px-3 py-2 text-sm text-[var(--vf-text)] hover:bg-[var(--vf-bg-sub)]"
                  >
                    <span className="font-medium">{z.name}</span>
                    <span className="text-xs text-[var(--vf-text-mute)]">{z.code}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Verificar que la zona existe y pertenece al customer.
  const zone = zones.find((z) => z.id === zoneId);
  if (!zone) {
    redirect('/dispatches/new/visual');
  }

  // Cargar todos los recursos de la zona en paralelo.
  const [allStores, vehicles, drivers, depots] = await Promise.all([
    listStores({ zoneId, activeOnly: true }),
    listVehicles({ zoneId, activeOnly: true }),
    listDrivers({ zoneId, activeOnly: true }),
    listDepots(),
  ]);

  // FIX: filtrar tiendas sin coords válidas. Si el catálogo tiene rows con
  // lat/lng null (porque nunca geocodificaron) o (0,0) sentinel, romperíamos
  // mapbox con "Invalid LngLat object: (NaN, NaN)". El user las re-geocodifica
  // desde /stores/import o /settings/stores/<id>.
  const isValidCoord = (n: unknown): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n !== 0;
  const stores = allStores.filter((s) => isValidCoord(s.lat) && isValidCoord(s.lng));
  const missingCoordsCount = allStores.length - stores.length;

  // Fecha default = mañana (el dispatcher arma con anticipación).
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const defaultDate = tomorrow.toISOString().slice(0, 10);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  return (
    <VisualDispatchBuilder
      zone={{ id: zone.id, name: zone.name, code: zone.code }}
      availableZones={zones.map((z) => ({ id: z.id, name: z.name, code: z.code }))}
      missingCoordsCount={missingCoordsCount}
      stores={stores.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        demand: s.demand,
      }))}
      vehicles={vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        alias: v.alias,
        capacity: v.capacity,
        depotId: v.depotId,
        depotLat: v.depotLat,
        depotLng: v.depotLng,
      }))}
      drivers={drivers.map((d) => ({
        id: d.id,
        fullName: d.fullName,
      }))}
      depots={depots.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        lat: d.lat,
        lng: d.lng,
      }))}
      defaultDate={defaultDate}
      mapboxToken={mapboxToken}
    />
  );
}
