// Overview del Control Plane — Sprint 17.
// Sprint 18 agregará agregaciones reales de KPIs cross-tenant. Hoy mostramos
// solo el conteo y resumen de tenants registrados.

import { PageHeader, Card } from '@verdfrut/ui';
import { getTenantsAggregate } from '@/lib/queries/tenants';

export const metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

const fmtInt = new Intl.NumberFormat('es-MX');
const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

export default async function OverviewPage() {
  const agg = await getTenantsAggregate();

  const kpis = [
    { label: 'Tenants activos', value: fmtInt.format(agg.byStatus.active) },
    { label: 'Provisioning', value: fmtInt.format(agg.byStatus.provisioning) },
    { label: 'Suspendidos', value: fmtInt.format(agg.byStatus.suspended) },
    { label: 'MRR contratado', value: fmtCurrency.format(agg.totalMonthlyFee) },
    { label: 'Zonas (todos)', value: fmtInt.format(agg.totalZones) },
    { label: 'Choferes (todos)', value: fmtInt.format(agg.totalDrivers) },
    { label: 'Rutas activas hoy', value: fmtInt.format(agg.totalActiveRoutes) },
    { label: 'Total registrados', value: fmtInt.format(agg.total) },
  ];

  return (
    <>
      <PageHeader
        title="Overview"
        description="Estado agregado de todos los tenants gestionados por TripDrive"
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {k.label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--color-text)]">
              {k.value}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-[var(--color-text)]">Próximos pasos</h2>
        <ul className="ml-4 list-disc text-sm text-[var(--color-text-muted)]">
          <li>Sprint 18: KPIs agregados cross-tenant + sync diario</li>
          <li>Sprint 19: Onboarding wizard que provisiona tenant Supabase + migrations</li>
          <li>Sprint 20+: billing manual y reportes mensuales</li>
        </ul>
      </Card>
    </>
  );
}
