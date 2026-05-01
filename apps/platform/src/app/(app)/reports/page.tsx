// Reportes operativos — KPIs filtrables por zona, chofer, tienda, fecha.
// Versión completa se construye en Fase 5 (Dashboard).

import { Card, EmptyState, PageHeader } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';
import { listRoutes } from '@/lib/queries/routes';

export const metadata = { title: 'Reportes' };

export default async function ReportsPage() {
  await requireRole('admin', 'dispatcher', 'zone_manager');

  // Métricas básicas que sí podemos calcular hoy (sin esperar Fase 5).
  // Pedimos limit alto porque el endpoint paginado nos da el total exacto via .count.
  const { rows: allRoutes, total: totalRoutes } = await listRoutes({ limit: 1000 });
  const completedRoutes = allRoutes.filter((r) => r.status === 'COMPLETED').length;
  const inProgressRoutes = allRoutes.filter((r) => r.status === 'IN_PROGRESS').length;
  const cancelledRoutes = allRoutes.filter((r) => r.status === 'CANCELLED').length;

  return (
    <>
      <PageHeader
        title="Reportes"
        description="Métricas operativas. Versión avanzada con filtros y gráficas en Fase 5."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Rutas totales" value={totalRoutes} />
        <Kpi label="Completadas" value={completedRoutes} />
        <Kpi label="En curso" value={inProgressRoutes} />
        <Kpi label="Canceladas" value={cancelledRoutes} />
      </div>

      <div className="mt-6">
        <EmptyState
          title="Reportes detallados — Fase 5"
          description="Gráficas, filtros por zona/chofer/tienda, export CSV/PDF y comparativas por periodo se habilitan cuando haya volumen de datos operativos."
        />
      </div>
    </>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-[10px] uppercase tracking-[0.04em]" style={{ color: 'var(--vf-text-mute)' }}>
        {label}
      </p>
      <p
        className="mt-1 font-mono text-[28px] tabular-nums"
        style={{ color: 'var(--vf-text)', fontWeight: 500, letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
    </Card>
  );
}
