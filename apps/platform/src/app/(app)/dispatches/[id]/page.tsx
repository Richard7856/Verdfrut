// Detalle de un tiro (dispatch). ADR-024.
// Muestra mapa multi-route, lista de rutas con su estado y permite agregar/quitar.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, PageHeader, Button } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { getDispatch, listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listRoutes, countStopsForRoutes } from '@/lib/queries/routes';
import { listStopsForRoutes } from '@/lib/queries/stops';
import { listZones } from '@/lib/queries/zones';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { listUsers } from '@/lib/queries/users';
import { listStores } from '@/lib/queries/stores';
import { listDepots } from '@/lib/queries/depots';
import { MultiRouteMapServer } from '@/components/map/multi-route-map-server';
import { AssignRouteForm } from './assign-route-form';
import { DispatchActions } from './dispatch-actions';
import { RouteStopsCard } from './route-stops-card';
import { ShareDispatchButton } from './share-dispatch-button';
import { AddVehicleButton } from './add-vehicle-button';
import type { ChatStatus, DispatchStatus, Store } from '@verdfrut/types';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

// El status label de cada ruta vive ahora en route-stops-card.tsx — aquí solo
// renderizamos el dispatch.

const DISPATCH_STATUS_LABEL: Record<DispatchStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'danger' }> = {
  planning: { text: 'Planeación', tone: 'neutral' },
  dispatched: { text: 'En curso', tone: 'info' },
  completed: { text: 'Completado', tone: 'success' },
  cancelled: { text: 'Cancelado', tone: 'danger' },
};

export default async function DispatchDetailPage({ params }: Props) {
  await requireRole('admin', 'dispatcher');
  const { id } = await params;
  const dispatch = await getDispatch(id);
  if (!dispatch) notFound();

  const [routes, allRoutesData, zones, vehicles, stores, zoneDrivers, zoneUsers, allDepots] = await Promise.all([
    listRoutesByDispatch(id),
    listRoutes({ date: dispatch.date, zoneId: dispatch.zoneId, limit: 200 }),
    listZones(),
    listVehicles({}),
    listStores({ activeOnly: false }),
    listDrivers({ zoneId: dispatch.zoneId, activeOnly: true }),
    listUsers({ role: 'driver', zoneId: dispatch.zoneId }),
    listDepots(),
  ]);
  // P1-1: una sola query batch en lugar de N. Para tiros con 5+ rutas reduce
  // el tiempo total ~5x (cuello de botella era RTT por ruta, no scan).
  const routeIds = routes.map((r) => r.id);
  const stopCounts = await countStopsForRoutes(routeIds);
  const stopsByRouteId = await listStopsForRoutes(routeIds);
  const stopsPerRoute = routes.map((r) => stopsByRouteId.get(r.id) ?? []);
  const storesById = new Map<string, Store>(stores.map((s) => [s.id, s]));
  const siblings = routes.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    vehicleId: r.vehicleId,
  }));

  // Rutas candidatas a agregar: misma zona, misma fecha, sin dispatch_id.
  const candidateRoutes = allRoutesData.rows.filter(
    (r) => r.dispatchId === null,
  );

  const status = DISPATCH_STATUS_LABEL[dispatch.status];
  const zone = zones.find((z) => z.id === dispatch.zoneId);
  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

  // Para el mapa, solo rutas con paradas.
  const routesWithStops = routes.filter((r) => (stopCounts.get(r.id)?.total ?? 0) > 0);

  // Vehículos disponibles para agregar al tiro: misma zona, activos, NO usados ya
  // por una ruta viva (no CANCELLED) del tiro. ADR-048.
  const usedVehicleIds = new Set(
    routes.filter((r) => r.status !== 'CANCELLED').map((r) => r.vehicleId),
  );
  const availableVehicles = vehicles
    .filter((v) => v.isActive && v.zoneId === dispatch.zoneId && !usedVehicleIds.has(v.id))
    .map((v) => ({
      id: v.id,
      label: `${v.plate}${v.alias ? ` · ${v.alias}` : ''}`,
      zoneId: v.zoneId,
    }));

  // Lista de depots para los selectores inline en cada card de ruta. ADR-047
  // permite override cross-zona, así que mostramos todos los depots activos.
  const depotsById = new Map(allDepots.map((d) => [d.id, d]));
  const availableDepotOptions = allDepots
    .filter((d) => d.isActive)
    .map((d) => ({ id: d.id, code: d.code, name: d.name }));

  // Tiendas disponibles para agregar manualmente: activas de la zona del tiro
  // que NO están YA en NINGUNA ruta viva del tiro. Si una tienda está en
  // Kangoo 2 y el dispatcher la quiere en Kangoo 3, debe usar "Mover a →"
  // (transfer entre rutas) — duplicarla rompería la entrega (la tienda no
  // puede recibir dos veces el mismo día).
  const usedInDispatchStoreIds = new Set<string>();
  for (let idx = 0; idx < routes.length; idx++) {
    if (routes[idx]!.status === 'CANCELLED') continue;
    for (const s of stopsPerRoute[idx] ?? []) {
      usedInDispatchStoreIds.add(s.storeId);
    }
  }
  const allZoneStoresActive = stores.filter(
    (s) => s.isActive && s.zoneId === dispatch.zoneId && !usedInDispatchStoreIds.has(s.id),
  );

  // Choferes activos en la zona para el selector.
  const profilesByUserId = new Map(zoneUsers.map((p) => [p.id, p]));
  const availableDriverOpts = zoneDrivers
    .map((d) => {
      const profile = profilesByUserId.get(d.userId);
      if (!profile || !profile.isActive) return null;
      return { id: d.id, fullName: profile.fullName, zoneId: d.zoneId };
    })
    .filter((x): x is { id: string; fullName: string; zoneId: string } => x !== null);

  return (
    <>
      <PageHeader
        title={dispatch.name}
        description={`${zone?.name ?? '—'} · ${dispatch.date} · ${routes.length} ruta${routes.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.text}</Badge>
            <ShareDispatchButton
              dispatchId={dispatch.id}
              currentToken={dispatch.publicShareToken}
            />
            <DispatchActions dispatch={dispatch} />
          </div>
        }
      />

      {dispatch.notes && (
        <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <p className="text-sm text-[var(--color-text)]">{dispatch.notes}</p>
        </Card>
      )}

      {routesWithStops.length > 0 && (
        <div className="mb-4">
          <MultiRouteMapServer routes={routesWithStops} mapboxToken={mapboxToken} />
        </div>
      )}

      <section className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Rutas del tiro
          </h2>
          <div className="flex items-center gap-2">
            {/* ADR-048: agregar camioneta = re-rutea todo el tiro automáticamente. */}
            <AddVehicleButton
              dispatchId={dispatch.id}
              availableVehicles={availableVehicles}
              availableDrivers={availableDriverOpts}
            />
            {/* Botón legacy: crear ruta nueva manualmente (sin redistribuir). */}
            <Link href={`/routes/new?dispatchId=${dispatch.id}`}>
              <Button type="button" variant="ghost" size="sm">
                + Ruta manual
              </Button>
            </Link>
          </div>
        </header>

        {routes.length === 0 ? (
          <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
            <p className="text-sm text-[var(--color-text-muted)]">
              Este tiro no tiene rutas todavía. Crea una nueva o vincula una ruta existente abajo.
            </p>
          </Card>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {routes.map((r, idx) => {
              const stops = stopsPerRoute[idx] ?? [];
              const vehicle = vehicles.find((v) => v.id === r.vehicleId);
              // capacity = [peso, vol, cajas] — el tercer dim es lo que usamos como cap visible.
              const capacityCajas = (vehicle?.capacity?.[2] as number | undefined) ?? 0;

              // Resolver depot effective para esta ruta (ADR-047: override > vehicle).
              let effectiveDepot: { id: string; code: string; name: string } | null = null;
              let isDepotOverride = false;
              if (r.depotOverrideId) {
                const d = depotsById.get(r.depotOverrideId);
                if (d) {
                  effectiveDepot = { id: d.id, code: d.code, name: d.name };
                  isDepotOverride = true;
                }
              }
              if (!effectiveDepot && vehicle?.depotId) {
                const d = depotsById.get(vehicle.depotId);
                if (d) effectiveDepot = { id: d.id, code: d.code, name: d.name };
              }

              // Tiendas que esta ruta puede agregar: las que NO están en NINGUNA
              // ruta viva del tiro (ya filtradas arriba en allZoneStoresActive).
              // Si quiere mover una tienda desde otra ruta, usa "Mover a →".
              const availableStoresForRoute = allZoneStoresActive.map((s) => ({
                id: s.id,
                code: s.code,
                name: s.name,
              }));

              return (
                <li key={r.id}>
                  <RouteStopsCard
                    dispatchId={dispatch.id}
                    route={r}
                    stops={stops}
                    storesById={storesById}
                    vehicles={vehicles}
                    siblings={siblings}
                    capacityCajas={capacityCajas}
                    effectiveDepot={effectiveDepot}
                    isDepotOverride={isDepotOverride}
                    availableDepots={availableDepotOptions}
                    availableStoresToAdd={availableStoresForRoute}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {candidateRoutes.length > 0 && (
          <Card className="border-[var(--color-border)]">
            <p className="mb-2 text-xs font-medium text-[var(--color-text)]">
              Vincular ruta existente al tiro
            </p>
            <p className="mb-3 text-xs text-[var(--color-text-muted)]">
              Solo rutas de la misma zona y fecha sin tiro asignado.
            </p>
            <AssignRouteForm dispatchId={dispatch.id} candidates={candidateRoutes} vehicles={vehicles} />
          </Card>
        )}
      </section>
    </>
  );
}

// Suprimir warnings de tipos no usados (sin acoplar al ChatStatus pero lo importé al inicio)
void ({} as ChatStatus | undefined);
