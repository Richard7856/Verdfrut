// Top stores y top drivers — server component, lado a lado en desktop.
// Sprint 14 + Sprint 15 (links de drill-down a páginas de detalle).

import Link from 'next/link';
import { Card, DataTable, type Column } from '@tripdrive/ui';
import type { TopStoreRow, TopDriverRow } from '@/lib/queries/dashboard';

interface Props {
  topStores: TopStoreRow[];
  topDrivers: TopDriverRow[];
}

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtKm = (m: number) => `${(m / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`;

const STORE_COLS: Column<TopStoreRow>[] = [
  {
    key: 'name',
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

const DRIVER_COLS: Column<TopDriverRow>[] = [
  {
    key: 'name',
    header: 'Chofer',
    cell: (r) => (
      <Link
        href={`/dashboard/drivers/${r.driverId}`}
        className="font-medium text-[var(--color-text)] hover:text-[var(--vf-green-600,#15803d)]"
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

export function TopTables({ topStores, topDrivers }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Top tiendas por visitas
            </h2>
            <Link
              href="/dashboard/stores"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--vf-green-600,#15803d)]"
            >
              Ver todas →
            </Link>
          </div>
          <DataTable
            columns={STORE_COLS}
            rows={topStores}
            rowKey={(r) => r.storeId}
            emptyTitle="Sin actividad de tiendas"
            emptyDescription="No hay reportes de entrega en el rango seleccionado."
          />
        </Card>
      </div>
      <div>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">
              Top choferes por rutas completadas
            </h2>
            <Link
              href="/dashboard/drivers"
              className="text-xs text-[var(--color-text-muted)] hover:text-[var(--vf-green-600,#15803d)]"
            >
              Ver todos →
            </Link>
          </div>
          <DataTable
            columns={DRIVER_COLS}
            rows={topDrivers}
            rowKey={(r) => r.driverId}
            emptyTitle="Sin choferes activos"
            emptyDescription="No hay rutas completadas en el rango seleccionado."
          />
        </Card>
      </div>
    </div>
  );
}
