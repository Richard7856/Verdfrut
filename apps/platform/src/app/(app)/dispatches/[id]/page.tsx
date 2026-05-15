// Detalle de un tiro (dispatch). ADR-024.
// Muestra mapa multi-route, lista de rutas con su estado y permite agregar/quitar.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, PageHeader, Button } from '@tripdrive/ui';
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
import { EtaModeBanner, isEtaModeDemo } from '@/components/shell/eta-mode-banner';
// `AssignRouteForm` removido — ADR-040 hizo dispatch_id NOT NULL, ya no
// existen rutas huérfanas que vincular a un tiro.
import { DispatchActions } from './dispatch-actions';
import { RouteStopsCard } from './route-stops-card';
import { ShareDispatchButton } from './share-dispatch-button';
import { AddVehicleButton } from './add-vehicle-button';
import { RestructureSnapshotBanner } from './restructure-snapshot-banner';
import { OptimizeDispatchButton } from './optimize-dispatch-button';
import type { ChatStatus, DispatchStatus, Store } from '@tripdrive/types';

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

  const [routes, zones, vehicles, stores, zoneDrivers, zoneUsers, allDepots] = await Promise.all([
    listRoutesByDispatch(id),
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

  // ADR-040 (2026-04): `routes.dispatch_id` es NOT NULL — toda ruta vive
  // dentro de un tiro. La query de "candidateRoutes huérfanas" se eliminó.

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
      label: v.alias ? `${v.alias} (${v.plate})` : v.plate,
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

  // H3.5: ¿alguna ruta viva tiene version > 1? Indica reorder manual / cambios
  // post-optimizer. Si redistribuyen, eso se pierde — el modal lo advierte.
  const hasManualReorders = routes.some(
    (r) => r.status !== 'CANCELLED' && r.version > 1,
  );

  // Para el botón "Optimizar tiro" — habilitado si hay al menos una ruta
  // optimizable con paradas. Bloqueado si alguna ruta ya está publicada
  // (post-publish requiere el flujo de re-optimización en vivo por ruta).
  const POST_PUBLISH_STATUSES = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
  const hasPostPublishRoutes = routes.some((r) => POST_PUBLISH_STATUSES.has(r.status));
  const canOptimizeDispatch = routes.some((r, idx) => {
    if (r.status !== 'DRAFT' && r.status !== 'OPTIMIZED') return false;
    return (stopsPerRoute[idx]?.length ?? 0) > 0;
  });

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

      <EtaModeBanner show={isEtaModeDemo()} />

      {/* H3.4: banner comparativo tras redistribuir (lee sessionStorage). */}
      <RestructureSnapshotBanner
        dispatchId={dispatch.id}
        storesById={new Map(stores.map((s) => [s.id, { code: s.code, name: s.name }]))}
      />

      {dispatch.notes && (
        <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)]">
          <p className="text-sm text-[var(--color-text)]">{dispatch.notes}</p>
        </Card>
      )}

      {routesWithStops.length > 0 && (
        <div className="mb-4">
          <MultiRouteMapServer
            routes={routesWithStops}
            mapboxToken={mapboxToken}
            dispatchId={dispatch.id}
          />
        </div>
      )}

      <section className="flex flex-col gap-4">
        <header className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            Rutas del tiro
          </h2>
          <div className="flex items-center gap-2">
            {/* Optimizar tiro completo (modo across o within). */}
            <OptimizeDispatchButton
              dispatchId={dispatch.id}
              canOptimize={canOptimizeDispatch}
              hasPostPublishRoutes={hasPostPublishRoutes}
              hasManualReorders={hasManualReorders}
            />
            {/* ADR-048: agregar camioneta = re-rutea todo el tiro automáticamente. */}
            <AddVehicleButton
              dispatchId={dispatch.id}
              availableVehicles={availableVehicles}
              availableDrivers={availableDriverOpts}
              hasManualReorders={hasManualReorders}
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
          <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)] p-8 text-center">
            <p className="text-base font-medium text-[var(--color-text)]">
              Este tiro está vacío
            </p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Usa los botones de arriba: <strong>+ Agregar camioneta</strong> abre el wizard
              de selección de tiendas con auto-optimización, o <strong>+ Ruta manual</strong>
              te lleva al formulario completo.
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
                    dispatchHasManualReorders={hasManualReorders}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {/* Card "Vincular ruta existente" eliminada — ADR-040 hizo
            routes.dispatch_id NOT NULL, ya no existen rutas huérfanas que
            vincular. Si en el futuro queremos "mover ruta entre tiros", es
            feature aparte (moveRouteToAnotherDispatch action). */}
      </section>
    </>
  );
}

// Suprimir warnings de tipos no usados (sin acoplar al ChatStatus pero lo importé al inicio)
void ({} as ChatStatus | undefined);
