// Detalle de un tiro (dispatch). ADR-024.
// Muestra mapa multi-route, lista de rutas con su estado y permite agregar/quitar.

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, PageHeader, Button } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { getDispatch, listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listRoutes, countStopsForRoutes } from '@/lib/queries/routes';
import { listStopsForRoute } from '@/lib/queries/stops';
import { listZones } from '@/lib/queries/zones';
import { listVehicles } from '@/lib/queries/vehicles';
import { listStores } from '@/lib/queries/stores';
import { MultiRouteMapServer } from '@/components/map/multi-route-map-server';
import { AssignRouteForm } from './assign-route-form';
import { DispatchActions } from './dispatch-actions';
import { RouteStopsCard } from './route-stops-card';
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

  const [routes, allRoutesData, zones, vehicles, stores] = await Promise.all([
    listRoutesByDispatch(id),
    listRoutes({ date: dispatch.date, zoneId: dispatch.zoneId, limit: 200 }),
    listZones(),
    listVehicles({}),
    listStores({ activeOnly: false }),
  ]);
  const stopCounts = await countStopsForRoutes(routes.map((r) => r.id));
  // Cargar paradas de cada ruta del tiro (paralelo).
  const stopsPerRoute = await Promise.all(routes.map((r) => listStopsForRoute(r.id)));
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

  return (
    <>
      <PageHeader
        title={dispatch.name}
        description={`${zone?.name ?? '—'} · ${dispatch.date} · ${routes.length} ruta${routes.length === 1 ? '' : 's'}`}
        action={
          <div className="flex items-center gap-2">
            <Badge tone={status.tone}>{status.text}</Badge>
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
          <Link href={`/routes/new?dispatchId=${dispatch.id}`}>
            <Button type="button" variant="primary" size="sm">
              + Crear ruta nueva
            </Button>
          </Link>
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
