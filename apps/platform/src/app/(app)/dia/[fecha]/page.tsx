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
import { DayFilters, type StatusBucket, type RecentDayInfo } from './day-filters';
import { OptimizeDayButton } from './optimize-day-button';
import { QuickRouteButton } from './quick-route-button';
import { createServerClient } from '@tripdrive/supabase/server';

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

  // Nombres legibles de los tiros (en vez de mostrar UUID truncado).
  const supabaseShared = await createServerClient();
  const dispatchNameById = new Map<string, string>();
  if (uniqueDispatchIds.length > 0) {
    const { data: dispatchRows } = await supabaseShared
      .from('dispatches')
      .select('id, name')
      .in('id', uniqueDispatchIds);
    for (const d of dispatchRows ?? []) {
      dispatchNameById.set(d.id as string, (d.name as string) ?? 'Tiro');
    }
  }

  // Strip de últimos 7 días con actividad — para navegación rápida sin teclear.
  const recentDays: RecentDayInfo[] = await buildRecentDaysStrip(fecha);

  return (
    <>
      <PageHeader
        title={`Día ${fecha}`}
        description="Todas las rutas del día en un solo mapa. Selecciona paradas con Shift+drag o Cmd+A para moverlas entre camionetas, incluso entre planes distintos."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <OptimizeDayButton
              fecha={fecha}
              optimizableRoutes={allRoutes
                .filter((r) => r.status === 'DRAFT' || r.status === 'OPTIMIZED')
                .map((r) => {
                  const vehicle = vehiclesById.get(r.vehicleId);
                  return {
                    name: vehicle?.alias ?? vehicle?.plate ?? r.name,
                    stopCount: stopCounts.get(r.id)?.total ?? 0,
                  };
                })}
            />
            <Link
              href={`/dispatches/new/visual?date=${fecha}`}
              className="rounded-md border border-emerald-700 bg-emerald-950/30 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50"
              title="Armar un plan del día desde el mapa: selecciona tiendas y asígnalas a camionetas visualmente"
            >
              🗺️ Armar día visual
            </Link>
            {/* ADR-119 / UX-Fase 3: ruta huérfana sin tiro previo. */}
            <QuickRouteButton
              fecha={fecha}
              vehicles={vehicles
                .filter((v) => v.isActive)
                .map((v) => ({
                  id: v.id,
                  alias: v.alias,
                  plate: v.plate,
                  zoneId: v.zoneId,
                }))}
              drivers={zoneDrivers
                .filter((d) => d.isActive)
                .map((d) => {
                  const userId = driverUserIds.get(d.id);
                  const fullName = userId ? userById.get(userId)?.fullName ?? '(sin nombre)' : '(sin nombre)';
                  return { id: d.id, fullName, zoneId: d.zoneId };
                })}
              zones={zones
                .filter((z) => z.isActive)
                .map((z) => ({ id: z.id, code: z.code, name: z.name }))}
              defaultZoneId={zoneParam || null}
            />
          </div>
        }
      />

      <div className="mb-3">
        <DayFilters
          fecha={fecha}
          zones={zones.map((z) => ({ id: z.id, name: z.name, code: z.code }))}
          selectedZoneId={zoneParam || null}
          selectedStatusBuckets={selectedBuckets}
          counts={counts}
          recentDays={recentDays}
        />
      </div>

      {/* Métricas del día filtrado */}
      <Card className="mb-3 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Metric label="Rutas visibles" value={`${routes.length}`} hint={`de ${allRoutes.length} del día`} />
          <Metric label="Paradas" value={`${totals.completedStops} / ${totals.totalStops}`} hint="completadas" />
          <Metric label="Distancia" value={formatKilometers(totals.distanceMeters)} hint="suma de rutas" />
          <Metric
            label="Planes activos"
            value={`${uniqueDispatchIds.length}`}
            hint="grupos creados hoy"
          />
        </div>
      </Card>

      {mapRoutes.length > 0 ? (
        <div className="mb-4">
          {/* UX-Fase 2: bulk selection cross-dispatch. El user selecciona
              paradas con Shift+drag / Cmd+A / clicks y las mueve entre
              CUALQUIER ruta del día (incluso si pertenecen a planes
              distintos). La action revalida todos los dispatches afectados
              + /dia/[fecha] automáticamente. */}
          <MultiRouteMapServer
            routes={mapRoutes}
            mapboxToken={mapboxToken}
            scope={{ type: 'day', fecha }}
          />
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
                  <div className="flex items-start gap-2 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-2.5 hover:bg-[var(--vf-surface-3)]">
                    <Link href={`/routes/${r.id}`} className="block min-w-0 flex-1">
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
                    {/* PDF por ruta (no global) — cada camioneta tiene su layout. */}
                    <a
                      href={`/print/routes/${r.id}`}
                      target="_blank"
                      rel="noopener"
                      title="Abrir PDF para esta camioneta"
                      className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-3)] px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                      📄 PDF
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {uniqueDispatchIds.length > 0 && (
          <div className="mt-4 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
            <p className="text-xs text-[var(--color-text-muted)]">
              Edición avanzada — mover paradas entre camionetas en bloque, optimizar todo el
              plan, ver propuestas con costo MXN, agregar más camionetas. Abre el plan al que
              pertenece la ruta:
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {uniqueDispatchIds.map((id) => {
                const name = dispatchNameById.get(id) ?? `Tiro ${id.slice(0, 6)}`;
                return (
                  <Link
                    key={id}
                    href={`/dispatches/${id}`}
                    className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-3)] px-2 py-1 text-xs text-[var(--color-text)] hover:bg-[var(--vf-surface-2)]"
                    title={`Abrir tiro ${name}`}
                  >
                    📋 {name}
                  </Link>
                );
              })}
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

/**
 * Strip de últimos 7 días centrado alrededor del día actual mostrando cuántas
 * rutas vivas (no canceladas, no sandbox) tiene cada uno. Single query batch
 * para que sea barato. Sirve para jumps rápidos sin teclear fecha.
 */
async function buildRecentDaysStrip(centerDate: string): Promise<RecentDayInfo[]> {
  // 3 días antes + actual + 3 días después = ventana de 7.
  const center = new Date(`${centerDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let i = -3; i <= 3; i++) {
    const d = new Date(center);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }
  const supabase = await createServerClient();
  const { data } = await supabase
    .from('routes')
    .select('date, status')
    .in('date', dates)
    .eq('is_sandbox', false)
    .neq('status', 'CANCELLED');
  type RouteRow = { date: string; status: string };
  const rows = (data ?? []) as RouteRow[];

  const LIVE_STATUSES = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED']);
  const stats = new Map<string, { count: number; live: boolean }>();
  for (const d of dates) stats.set(d, { count: 0, live: false });
  for (const r of rows) {
    const entry = stats.get(r.date);
    if (!entry) continue;
    entry.count += 1;
    if (LIVE_STATUSES.has(r.status)) entry.live = true;
  }
  return dates.map((d) => {
    const s = stats.get(d)!;
    return { date: d, routeCount: s.count, hasLive: s.live };
  });
}
