// Vista unificada por día — TODAS las rutas del día en un solo mapa, con
// filtros por zona y estado. El dispatcher entra acá para ver y comparar la
// operación del día completo en lugar de tener que abrir cada "tiro" (= grupo
// de rutas) por separado.
//
// El concepto de "tiro" (dispatch) se vuelve un drill-down opcional para
// editar un grupo específico; ya no es la puerta de entrada al ver el día.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, PageHeader } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { listRoutes } from '@/lib/queries/routes';
import { listZones } from '@/lib/queries/zones';
import { listVehicles } from '@/lib/queries/vehicles';
import { listDrivers } from '@/lib/queries/drivers';
import { listUsers } from '@/lib/queries/users';
import { countStopsForRoutes } from '@/lib/queries/routes';
import { MultiRouteMapServer } from '@/components/map/multi-route-map-server';
import { formatKilometers } from '@tripdrive/utils';
import type { Route, RouteStatus } from '@tripdrive/types';
import { DayFilters, type StatusBucket } from './day-filters';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ fecha: string }>;
  searchParams: Promise<{ zone?: string; status?: string }>;
}

// Bucket → set of RouteStatus. "plan" = pre-publicación; "live" = en curso;
// "done" = cerradas. Cancelled queda fuera por default (el dispatcher casi
// nunca quiere ver canceladas en el mapa); si se requiere, agregamos bucket 4.
const BUCKET_STATUSES: Record<StatusBucket, RouteStatus[]> = {
  plan: ['DRAFT', 'OPTIMIZED', 'APPROVED'],
  live: ['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED'],
  done: ['COMPLETED'],
};

const STATUS_TONE: Record<RouteStatus, 'neutral' | 'info' | 'success' | 'warning' | 'danger'> = {
  DRAFT: 'neutral',
  OPTIMIZED: 'info',
  APPROVED: 'info',
  PUBLISHED: 'info',
  IN_PROGRESS: 'success',
  INTERRUPTED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'danger',
};

const STATUS_LABEL: Record<RouteStatus, string> = {
  DRAFT: 'Borrador',
  OPTIMIZED: 'Optimizada',
  APPROVED: 'Aprobada',
  PUBLISHED: 'Publicada',
  IN_PROGRESS: 'En curso',
  INTERRUPTED: 'Interrumpida',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
};

export async function generateMetadata({ params }: Props) {
  const { fecha } = await params;
  return { title: `Día ${fecha}` };
}

export default async function DiaDetailPage({ params, searchParams }: Props) {
  await requireRole('admin', 'dispatcher');
  const { fecha } = await params;
  const { zone: zoneParam, status: statusParam } = await searchParams;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) notFound();

  // Parse status buckets desde URL. Si nada, defaultea a "plan" + "live" — el
  // dispatcher casi siempre quiere ver lo que está pasando o por pasar; las
  // cerradas las consulta explícitamente.
  const selectedBuckets = new Set<StatusBucket>(
    statusParam
      ? (statusParam.split(',').filter((s): s is StatusBucket =>
          s === 'plan' || s === 'live' || s === 'done',
        ))
      : ['plan', 'live'],
  );

  // Cargar TODO el día (sin filtro de status server-side) para poder mostrar
  // los conteos por bucket en los chips. Luego filtramos client-side al mapa.
  // Con date+zone filter, el universo es chico (~10-50 rutas en producción
  // típica), así que el fetch full-day es barato y nos ahorra round-trips.
  const [allRoutesRes, zones, vehicles, zoneDrivers, zoneUsers] = await Promise.all([
    listRoutes({
      date: fecha,
      zoneId: zoneParam || undefined,
      limit: 200,
    }),
    listZones(),
    listVehicles({}),
    listDrivers({ activeOnly: false }),
    listUsers({ role: 'driver' }),
  ]);

  const allRoutes = allRoutesRes.rows.filter((r) => r.status !== 'CANCELLED');

  // Conteo por bucket — usa todas las rutas del día (no las filtradas).
  const counts: Record<StatusBucket, number> = { plan: 0, live: 0, done: 0 };
  for (const r of allRoutes) {
    for (const b of (['plan', 'live', 'done'] as StatusBucket[])) {
      if (BUCKET_STATUSES[b].includes(r.status)) counts[b]++;
    }
  }

  // Rutas visibles = las que matchean al menos un bucket activo. Si no hay
  // bucket activo (raro), muestra todas las no-canceladas.
  const visibleStatuses = new Set<RouteStatus>();
  for (const b of selectedBuckets) {
    for (const s of BUCKET_STATUSES[b]) visibleStatuses.add(s);
  }
  const routes: Route[] =
    visibleStatuses.size === 0
      ? allRoutes
      : allRoutes.filter((r) => visibleStatuses.has(r.status));

  const routeIds = routes.map((r) => r.id);
  const stopCounts = await countStopsForRoutes(routeIds);

  const driverUserIds = new Map(zoneDrivers.map((d) => [d.id, d.userId]));
  const userById = new Map(zoneUsers.map((u) => [u.id, u]));
  const zonesById = new Map(zones.map((z) => [z.id, z]));
  const vehiclesById = new Map(vehicles.map((v) => [v.id, v]));

  // Métricas globales del día filtrado.
  const totals = routes.reduce(
    (acc, r) => {
      const sc = stopCounts.get(r.id);
      acc.distanceMeters += r.totalDistanceMeters ?? 0;
      acc.totalStops += sc?.total ?? 0;
      acc.completedStops += sc?.completed ?? 0;
      return acc;
    },
    { distanceMeters: 0, totalStops: 0, completedStops: 0 },
  );

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
  const mapRoutes = routes.filter((r) => (stopCounts.get(r.id)?.total ?? 0) > 0);

  // Dispatches únicos involucrados (para el drill-down "ver/editar grupo").
  const uniqueDispatchIds = Array.from(
    new Set(routes.map((r) => r.dispatchId).filter((x): x is string => Boolean(x))),
  );

  return (
    <>
      <PageHeader
        title={`Día ${fecha}`}
        description="Todas las rutas del día en un solo mapa. Filtra por zona o estado. Click en una ruta del listado para editar la camioneta."
      />

      <div className="mb-3">
        <DayFilters
          fecha={fecha}
          zones={zones.map((z) => ({ id: z.id, name: z.name, code: z.code }))}
          selectedZoneId={zoneParam || null}
          selectedStatusBuckets={selectedBuckets}
          counts={counts}
        />
      </div>

      {/* Métricas del día filtrado */}
      <Card className="mb-3 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Metric label="Rutas visibles" value={`${routes.length}`} hint={`de ${allRoutes.length} del día`} />
          <Metric label="Paradas" value={`${totals.completedStops} / ${totals.totalStops}`} hint="completadas" />
          <Metric label="Distancia" value={formatKilometers(totals.distanceMeters)} hint="suma de rutas" />
          <Metric
            label="Tiros agrupados"
            value={`${uniqueDispatchIds.length}`}
            hint="contenedores con rutas hoy"
          />
        </div>
      </Card>

      {mapRoutes.length > 0 ? (
        <div className="mb-4">
          <MultiRouteMapServer routes={mapRoutes} mapboxToken={mapboxToken} />
        </div>
      ) : (
        <Card className="mb-4 border-dashed border-[var(--color-border)] bg-[var(--vf-surface-2)] p-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            {allRoutes.length === 0
              ? 'No hay rutas para este día con los filtros actuales.'
              : 'Las rutas visibles no tienen paradas asignadas todavía.'}
          </p>
        </Card>
      )}

      {/* Listado lateral de rutas — click para entrar al detalle. */}
      <section>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
          Rutas del día ({routes.length})
        </h2>
        {routes.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">Ajusta los filtros para ver rutas.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {routes.map((r) => {
              const vehicle = vehiclesById.get(r.vehicleId);
              const driverUserId = r.driverId ? driverUserIds.get(r.driverId) : null;
              const driverProfile = driverUserId ? userById.get(driverUserId) : null;
              const sc = stopCounts.get(r.id);
              return (
                <li key={r.id}>
                  <Link
                    href={`/routes/${r.id}`}
                    className="block rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-2.5 hover:bg-[var(--vf-surface-3)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--color-text)]">
                          {vehicle?.alias ?? vehicle?.plate ?? r.name}
                        </p>
                        <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                          {zonesById.get(r.zoneId)?.name ?? '—'}
                          {driverProfile ? ` · ${driverProfile.fullName}` : ' · sin chofer'}
                          {sc ? ` · ${sc.completed}/${sc.total} paradas` : ''}
                          {r.totalDistanceMeters ? ` · ${formatKilometers(r.totalDistanceMeters)}` : ''}
                        </p>
                      </div>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {uniqueDispatchIds.length > 0 && (
          <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Para editar agrupaciones (mover paradas entre camionetas en bloque, optimizar tiro
              completo, etc.) entra al detalle del tiro:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {uniqueDispatchIds.map((id) => (
                <Link
                  key={id}
                  href={`/dispatches/${id}`}
                  className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-3)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--vf-surface-2)]"
                >
                  Editar tiro {id.slice(0, 8)}…
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-0.5 truncate text-sm font-semibold text-[var(--color-text)]">{value}</p>
      {hint && <p className="text-[10px] text-[var(--color-text-subtle)]">{hint}</p>}
    </div>
  );
}
