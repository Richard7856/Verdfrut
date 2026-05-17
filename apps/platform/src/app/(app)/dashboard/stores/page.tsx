// Listado de tiendas con métricas del período — Sprint 15.
// Reusa get_dashboard_top_stores con limit alto. Las tiendas con 0 actividad
// quedan fuera (HAVING COUNT > 0); para auditarlas: settings/stores.

import Link from 'next/link';
import { PageHeader, Card, DataTable, type Column } from '@tripdrive/ui';
import { todayInZone } from '@tripdrive/utils';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { getDashboardTopStores, type TopStoreRow } from '@/lib/queries/dashboard';
import { DashboardFilters } from '../dashboard-filters';

export const metadata = { title: 'Dashboard · Tiendas' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_RANGE_DAYS = 30;

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const COLS: Column<TopStoreRow>[] = [
  {
    key: 'store',
    header: 'Tienda',
    cell: (r) => (
      <Link
        href={`/dashboard/stores/${r.storeId}`}
        className="block hover:text-[var(--vf-green-600,#15803d)]"
      >
        <p className="font-medium text-[var(--color-text)]">{r.storeName}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{r.storeCode}</p>
      </Link>
    ),
  },
  {
    key: 'visits',
    header: 'Visitas',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtInt.format(r.visits)}</span>,
  },
  {
    key: 'billed',
    header: 'Facturado',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtCurrency.format(r.totalBilled)}</span>,
  },
  {
    key: 'avg',
    header: 'Ticket promedio',
    align: 'right',
    cell: (r) => (
      <span className="tabular-nums">
        {r.visits > 0 ? fmtCurrency.format(r.totalBilled / r.visits) : '—'}
      </span>
    ),
  },
  {
    key: 'incidents',
    header: 'Incidencias',
    align: 'right',
    cell: (r) => (
      <span
        className="tabular-nums"
        style={{ color: r.incidents > 0 ? 'var(--color-warning-fg,#d97706)' : 'inherit' }}
      >
        {fmtInt.format(r.incidents)}
      </span>
    ),
  },
];

interface SearchParams {
  from?: string;
  to?: string;
  zone?: string;
}

interface Props {
  searchParams: Promise<SearchParams>;
}

function defaultRange(timezone: string): { from: string; to: string } {
  const today = todayInZone(timezone);
  const toDate = new Date(today + 'T00:00:00Z');
  const fromDate = new Date(toDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - (DEFAULT_RANGE_DAYS - 1));
  return { from: fromDate.toISOString().slice(0, 10), to: today };
}

export default async function StoresDashboardPage({ searchParams }: Props) {
  // ADR-124: zone_manager read-only puede ver dashboard de tiendas.
  const profile = await requireRole('admin', 'dispatcher', 'zone_manager');
  const params = await searchParams;
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;

  const range = defaultRange(timezone);
  const from = params.from || range.from;
  const to = params.to || range.to;
  const isScopedSupervisor =
    profile.role === 'zone_manager' && profile.zoneId !== null;
  const zoneId = isScopedSupervisor ? profile.zoneId : params.zone || null;

  const [stores, zones] = await Promise.all([
    getDashboardTopStores({ from, to, zoneId, limit: 1000 }),
    isScopedSupervisor ? Promise.resolve([]) : listZones(),
  ]);

  return (
    <>
      <PageHeader
        title="Tiendas"
        description="Métricas por tienda en el período seleccionado"
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
        }
      />

      <DashboardFilters
        zones={zones.map((z) => ({ id: z.id, name: z.name }))}
        showZoneSelector={!isScopedSupervisor}
      />

      <Card>
        <DataTable
          columns={COLS}
          rows={stores}
          rowKey={(r) => r.storeId}
          emptyTitle="Sin actividad"
          emptyDescription="No hay reportes de entrega en el rango seleccionado."
        />
      </Card>
    </>
  );
}
