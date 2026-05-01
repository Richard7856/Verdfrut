// Stub — Dashboard de KPIs. Se construye con diseño detallado en Fase 5.

import { PageHeader, Card } from '@verdfrut/ui';
import { requireRole } from '@/lib/auth';

export const metadata = { title: 'Dashboard' };

export default async function DashboardPage() {
  await requireRole('admin', 'dispatcher', 'zone_manager');

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Métricas operativas en tiempo real"
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Entregas hoy', value: '—' },
          { label: '% Éxito', value: '—' },
          { label: 'Merma reportada', value: '—' },
          { label: 'Rutas activas', value: '—' },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {kpi.label}
            </p>
            <p className="mt-2 text-2xl font-semibold text-[var(--color-text)]">{kpi.value}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
