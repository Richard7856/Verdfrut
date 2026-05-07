// Detalle de un chofer — histórico de rutas + métricas en el período.
// Sprint 15.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, DataTable, type Column } from '@verdfrut/ui';
import { todayInZone, formatDuration } from '@verdfrut/utils';
import { requireRole } from '@/lib/auth';
import { getDriversByIds } from '@/lib/queries/drivers';
import { getDriverRoutes, type DriverRouteRow } from '@/lib/queries/dashboard';
import { DashboardFilters } from '../../dashboard-filters';

export const metadata = { title: 'Dashboard · Chofer' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_RANGE_DAYS = 30;

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtKm = (m: number | null) =>
  m == null ? '—' : `${(m / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`;

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  COMPLETED: 'success',
  IN_PROGRESS: 'info',
  PUBLISHED: 'info',
  APPROVED: 'neutral',
  OPTIMIZED: 'neutral',
  DRAFT: 'neutral',
  CANCELLED: 'danger',
};

interface SearchParams {
  from?: string;
  to?: string;
}

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}

function defaultRange(timezone: string): { from: string; to: string } {
  const today = todayInZone(timezone);
  const toDate = new Date(today + 'T00:00:00Z');
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_RANGE_DAYS - 1));
  return { from: fromDate.toISOString().slice(0, 10), to: today };
}

export default async function DriverDetailPage({ params, searchParams }: Props) {
  // V2: solo admin/dispatcher.
  await requireRole('admin', 'dispatcher');
  const { id } = await params;
  const sp = await searchParams;
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;

  const [driver] = await getDriversByIds([id]);
  if (!driver) notFound();

  const range = defaultRange(timezone);
  const from = sp.from || range.from;
  const to = sp.to || range.to;

  const routes = await getDriverRoutes({ driverId: id, from, to });

  // Agregaciones desde el histórico
  const completed = routes.filter((r) => r.status === 'COMPLETED');
  const totalRoutes = routes.length;
  const totalCompleted = completed.length;
  const totalDistance = completed.reduce((s, r) => s + (r.totalDistanceMeters ?? 0), 0);
  const totalDuration = completed.reduce((s, r) => s + (r.totalDurationSeconds ?? 0), 0);
  const totalStops = routes.reduce((s, r) => s + r.stopsTotal, 0);
  const stopsCompleted = routes.reduce((s, r) => s + r.stopsCompleted, 0);
  const stopsCompletionPct = totalStops > 0 ? stopsCompleted / totalStops : 0;
  const totalBilled = routes.reduce((s, r) => s + r.totalBilled, 0);

  const cols: Column<DriverRouteRow>[] = [
    {
      key: 'date',
      header: 'Fecha',
      cell: (r) => <span className="tabular-nums">{r.date}</span>,
    },
    {
      key: 'route',
      header: 'Ruta',
      cell: (r) => (
        <Link
          href={`/routes/${r.routeId}`}
          className="font-medium hover:text-[var(--vf-green-600,#15803d)]"
        >
          {r.routeName}
        </Link>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (r) => (
        <Badge tone={STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</Badge>
      ),
    },
    {
      key: 'stops',
      header: 'Paradas',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.stopsCompleted}/{r.stopsTotal}
        </span>
      ),
    },
    {
      key: 'distance',
      header: 'Distancia',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{fmtKm(r.totalDistanceMeters)}</span>,
    },
    {
      key: 'duration',
      header: 'Duración',
      align: 'right',
      cell: (r) => (
        <span className="tabular-nums">
          {r.totalDurationSeconds ? formatDuration(r.totalDurationSeconds) : '—'}
        </span>
      ),
    },
    {
      key: 'billed',
      header: 'Facturado',
      align: 'right',
      cell: (r) => <span className="tabular-nums">{fmtCurrency.format(r.totalBilled)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={driver.fullName}
        description={`${driver.licenseNumber ?? 'Sin licencia registrada'}${driver.phone ? ' · ' + driver.phone : ''}`}
        breadcrumb={
          <span className="flex items-center gap-1">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <Link href="/dashboard/drivers" className="hover:underline">Choferes</Link>
          </span>
        }
      />

      <DashboardFilters zones={[]} showZoneSelector={false} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Rutas completadas</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {fmtInt.format(totalCompleted)}
            {totalRoutes !== totalCompleted && (
              <span className="ml-1 text-sm text-[var(--color-text-muted)]">/ {totalRoutes}</span>
            )}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">% Completitud paradas</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {(stopsCompletionPct * 100).toFixed(1)}%
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {stopsCompleted}/{totalStops}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Distancia</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtKm(totalDistance)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Tiempo en ruta</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">
            {totalDuration > 0 ? formatDuration(totalDuration) : '—'}
          </p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Facturado</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtCurrency.format(totalBilled)}</p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Histórico de rutas
        </h2>
        <DataTable
          columns={cols}
          rows={routes}
          rowKey={(r) => r.routeId}
          emptyTitle="Sin rutas en el período"
        />
      </Card>
    </>
  );
}
