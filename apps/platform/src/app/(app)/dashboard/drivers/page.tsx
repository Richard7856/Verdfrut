// Listado de choferes con métricas del período — Sprint 15.

import Link from 'next/link';
import { PageHeader, Card, DataTable, type Column } from '@tripdrive/ui';
import { todayInZone } from '@tripdrive/utils';
import { requireRole } from '@/lib/auth';
import { listZones } from '@/lib/queries/zones';
import { getDashboardTopDrivers, type TopDriverRow } from '@/lib/queries/dashboard';
import { DashboardFilters } from '../dashboard-filters';

export const metadata = { title: 'Dashboard · Choferes' };
export const dynamic = 'force-dynamic';

const DEFAULT_TZ = 'America/Mexico_City';
const DEFAULT_RANGE_DAYS = 30;

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtKm = (m: number) => `${(m / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`;

const COLS: Column<TopDriverRow>[] = [
  {
    key: 'name',
    header: 'Chofer',
    cell: (r) => (
      <Link
        href={`/dashboard/drivers/${r.driverId}`}
        className="block font-medium text-[var(--color-text)] hover:text-[var(--vf-green-600,#15803d)]"
      >
        {r.driverName}
      </Link>
    ),
  },
  {
    key: 'routes',
    header: 'Rutas',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtInt.format(r.routesCount)}</span>,
  },
  {
    key: 'stops',
    header: 'Paradas',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtInt.format(r.stopsCompleted)}</span>,
  },
  {
    key: 'distance',
    header: 'Distancia',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtKm(r.totalDistanceMeters)}</span>,
  },
  {
    key: 'billed',
    header: 'Facturado',
    align: 'right',
    cell: (r) => <span className="tabular-nums">{fmtCurrency.format(r.totalBilled)}</span>,
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

export default async function DriversDashboardPage({ searchParams }: Props) {
  // V2: solo admin/dispatcher.
  const profile = await requireRole('admin', 'dispatcher');
  const params = await searchParams;
  const timezone = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? DEFAULT_TZ;

  const range = defaultRange(timezone);
  const from = params.from || range.from;
  const to = params.to || range.to;
  const zoneId =
    profile.role === 'zone_manager' ? profile.zoneId ?? null : params.zone || null;

  const [drivers, zones] = await Promise.all([
    getDashboardTopDrivers({ from, to, zoneId, limit: 1000 }),
    profile.role === 'zone_manager' ? Promise.resolve([]) : listZones(),
  ]);

  return (
    <>
      <PageHeader
        title="Choferes"
        description="Performance por chofer en el período seleccionado"
        breadcrumb={
          <Link href="/dashboard" className="hover:underline">
            Dashboard
          </Link>
        }
      />

      <DashboardFilters
        zones={zones.map((z) => ({ id: z.id, name: z.name }))}
        showZoneSelector={profile.role !== 'zone_manager'}
      />

      <Card>
        <DataTable
          columns={COLS}
          rows={drivers}
          rowKey={(r) => r.driverId}
          emptyTitle="Sin choferes activos"
          emptyDescription="No hay rutas completadas en el rango seleccionado."
        />
      </Card>
    </>
  );
}
