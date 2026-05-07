// Grid de 12 KPIs principales — Sprint 14.
// Server component. Recibe el overview ya computado.

import { Card } from '@verdfrut/ui';
import type { DashboardOverview } from '@/lib/queries/dashboard';

interface Props {
  overview: DashboardOverview;
}

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
const fmtKm = (m: number) => `${(m / 1000).toLocaleString('es-MX', { maximumFractionDigits: 1 })} km`;

export function KpiGrid({ overview }: Props) {
  const stopCompletionPct = overview.stopsTotal > 0
    ? overview.stopsCompleted / overview.stopsTotal
    : 0;
  const avgTicket = overview.numTickets > 0
    ? overview.totalBilled / overview.numTickets
    : 0;
  const mermaPct = overview.totalBilled > 0
    ? overview.totalReturned / overview.totalBilled
    : 0;

  const kpis: Array<{ label: string; value: string; group: 'op' | 'co' | 'q' }> = [
    // Operativos
    { label: 'Rutas completadas', value: fmtInt.format(overview.routesCompleted), group: 'op' },
    { label: 'Tiendas visitadas', value: fmtInt.format(overview.storesVisited), group: 'op' },
    { label: '% Completitud', value: fmtPct(stopCompletionPct), group: 'op' },
    { label: 'Distancia total', value: fmtKm(overview.totalDistanceMeters), group: 'op' },
    // Comerciales
    { label: 'Total facturado', value: fmtCurrency.format(overview.totalBilled), group: 'co' },
    { label: 'Ticket promedio', value: fmtCurrency.format(avgTicket), group: 'co' },
    { label: '# Tickets', value: fmtInt.format(overview.numTickets), group: 'co' },
    { label: '% Merma', value: fmtPct(mermaPct), group: 'co' },
    // Calidad
    { label: '# Incidencias', value: fmtInt.format(overview.totalIncidents), group: 'q' },
    { label: '# Tiendas cerradas', value: fmtInt.format(overview.numClosedStores), group: 'q' },
    { label: '# Reportes báscula', value: fmtInt.format(overview.numScaleIssues), group: 'q' },
    { label: '# Escalaciones', value: fmtInt.format(overview.numEscalations), group: 'q' },
  ];

  // Color de borde lateral por grupo — pista visual sin ruido excesivo
  const borderByGroup: Record<'op' | 'co' | 'q', string> = {
    op: 'var(--vf-green-600,#15803d)',
    co: 'var(--color-accent,#3b82f6)',
    q: 'var(--color-warning-fg,#d97706)',
  };

  return (
    <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <Card
          key={kpi.label}
          className="relative overflow-hidden"
          style={{ borderLeft: `3px solid ${borderByGroup[kpi.group]}` }}
        >
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {kpi.label}
          </p>
          <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
            {kpi.value}
          </p>
        </Card>
      ))}
    </div>
  );
}
