// Detalle de una tienda — histórico de visitas + métricas en el período.
// Sprint 15.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge, DataTable, type Column } from '@tripdrive/ui';
import { todayInZone, formatDateTimeInZone } from '@tripdrive/utils';
import { requireRole } from '@/lib/auth';
import { getStore } from '@/lib/queries/stores';
import { getStoreVisits, type StoreVisitRow } from '@/lib/queries/dashboard';
import { DashboardFilters } from '../../dashboard-filters';

export const metadata = { title: 'Dashboard · Tienda' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_RANGE_DAYS = 30;

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const TYPE_LABEL: Record<StoreVisitRow['type'], string> = {
  entrega: 'Entrega',
  tienda_cerrada: 'Cerrada',
  bascula: 'Báscula',
};

const TYPE_TONE: Record<StoreVisitRow['type'], 'success' | 'danger' | 'warning'> = {
  entrega: 'success',
  tienda_cerrada: 'danger',
  bascula: 'warning',
};

interface SearchParams {
  from?: string;
  to?: string;
  zone?: string;
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

export default async function StoreDetailPage({ params, searchParams }: Props) {
  // ADR-124: zone_manager también ve detalle de tienda (read-only).
  await requireRole('admin', 'dispatcher', 'zone_manager');
  const { id } = await params;
  const sp = await searchParams;
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;

  const store = await getStore(id);
  if (!store) notFound();

  const range = defaultRange(timezone);
  const from = sp.from || range.from;
  const to = sp.to || range.to;

  const visits = await getStoreVisits({ storeId: id, from, to });

  // Métricas agregadas computadas desde el histórico
  const totalVisits = visits.length;
  const totalBilled = visits.reduce((s, v) => s + (v.ticketTotal ?? 0), 0);
  const totalReturned = visits.reduce((s, v) => s + (v.returnTotal ?? 0), 0);
  const totalIncidents = visits.reduce((s, v) => s + v.incidentsCount, 0);
  const numClosed = visits.filter((v) => v.type === 'tienda_cerrada').length;
  const avgTicket = totalVisits > 0 && totalBilled > 0 ? totalBilled / totalVisits : 0;

  const cols: Column<StoreVisitRow>[] = [
    {
      key: 'date',
      header: 'Fecha',
      cell: (r) => (
        <span className="text-xs text-[var(--color-text-muted)]">
          {formatDateTimeInZone(r.createdAt, timezone)}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      cell: (r) => (
        <Badge tone={TYPE_TONE[r.type]}>{TYPE_LABEL[r.type]}</Badge>
      ),
    },
    {
      key: 'route',
      header: 'Ruta',
      cell: (r) =>
        r.routeId ? (
          <Link
            href={`/routes/${r.routeId}`}
            className="hover:text-[var(--vf-green-600,#15803d)]"
          >
            {r.routeName}
          </Link>
        ) : (
          '—'
        ),
    },
    {
      key: 'driver',
      header: 'Chofer',
      cell: (r) => r.driverName ?? '—',
    },
    {
      key: 'ticket',
      header: 'Ticket',
      align: 'right',
      cell: (r) => (
        <div className="flex flex-col items-end gap-0.5 tabular-nums">
          {r.ticketNumber && (
            <span className="text-xs text-[var(--color-text-muted)]">#{r.ticketNumber}</span>
          )}
          <span>{r.ticketTotal != null ? fmtCurrency.format(r.ticketTotal) : '—'}</span>
        </div>
      ),
    },
    {
      key: 'incidents',
      header: 'Incidentes',
      align: 'right',
      cell: (r) => (
        <span
          className="tabular-nums"
          style={{ color: r.incidentsCount > 0 ? 'var(--color-warning-fg,#d97706)' : 'inherit' }}
        >
          {fmtInt.format(r.incidentsCount)}
        </span>
      ),
    },
    {
      key: 'chat',
      header: 'Chat',
      cell: (r) =>
        r.chatStatus ? (
          <Link
            href={`/incidents/${r.reportId}`}
            className="text-xs hover:text-[var(--vf-green-600,#15803d)]"
          >
            {r.chatStatus}
          </Link>
        ) : (
          <span className="text-xs text-[var(--color-text-muted)]">—</span>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={store.name}
        description={`${store.code} · ${store.address || 'Sin dirección'}`}
        breadcrumb={
          <span className="flex items-center gap-1">
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            <span>/</span>
            <Link href="/dashboard/stores" className="hover:underline">Tiendas</Link>
          </span>
        }
      />

      <DashboardFilters zones={[]} showZoneSelector={false} />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Visitas</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtInt.format(totalVisits)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Facturado</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtCurrency.format(totalBilled)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Ticket promedio</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtCurrency.format(avgTicket)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Devuelto</p>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{fmtCurrency.format(totalReturned)}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">Incidentes</p>
          <p
            className="mt-2 text-2xl font-semibold tabular-nums"
            style={{ color: totalIncidents > 0 ? 'var(--color-warning-fg,#d97706)' : 'inherit' }}
          >
            {fmtInt.format(totalIncidents)}
          </p>
          {numClosed > 0 && (
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">{numClosed} cerradas</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">
          Histórico de visitas
        </h2>
        <DataTable
          columns={cols}
          rows={visits}
          rowKey={(r) => r.reportId}
          emptyTitle="Sin visitas en el período"
        />
      </Card>
    </>
  );
}
