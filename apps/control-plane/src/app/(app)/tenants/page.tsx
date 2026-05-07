// Lista de tenants registrados — Sprint 17.
// Sprint 18 agregará "última sync", indicadores de salud por tenant.
// Sprint 19 agregará el botón "Onboardear cliente" con wizard funcional.

import Link from 'next/link';
import { PageHeader, Card, Badge, DataTable, type Column } from '@verdfrut/ui';
import { listTenants, type Tenant, type TenantStatus } from '@/lib/queries/tenants';

export const metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});

const STATUS_TONE: Record<TenantStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  provisioning: 'warning',
  suspended: 'danger',
  archived: 'neutral',
};

const STATUS_LABEL: Record<TenantStatus, string> = {
  active: 'Activo',
  provisioning: 'Provisionando',
  suspended: 'Suspendido',
  archived: 'Archivado',
};

const COLS: Column<Tenant>[] = [
  {
    key: 'name',
    header: 'Cliente',
    cell: (r) => (
      <Link
        href={`/tenants/${r.slug}`}
        className="block hover:text-[var(--vf-green-600,#15803d)]"
      >
        <p className="font-medium text-[var(--color-text)]">{r.name}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{r.slug}</p>
      </Link>
    ),
  },
  {
    key: 'status',
    header: 'Estado',
    cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
  },
  {
    key: 'plan',
    header: 'Plan',
    cell: (r) => <span className="capitalize">{r.plan}</span>,
  },
  {
    key: 'project',
    header: 'Proyecto Supabase',
    cell: (r) =>
      r.supabaseProjectRef ? (
        <code className="text-xs text-[var(--color-text-muted)]">{r.supabaseProjectRef}</code>
      ) : (
        <span className="text-xs text-[var(--color-text-muted)]">—</span>
      ),
  },
  {
    key: 'fee',
    header: 'MRR',
    align: 'right',
    cell: (r) => (
      <span className="tabular-nums">
        {r.monthlyFee !== null ? fmtCurrency.format(r.monthlyFee) : '—'}
      </span>
    ),
  },
  {
    key: 'sync',
    header: 'Último sync',
    align: 'right',
    cell: (r) => (
      <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
        {r.lastSyncAt ? new Date(r.lastSyncAt).toLocaleString('es-MX') : 'Nunca'}
      </span>
    ),
  },
];

export default async function TenantsPage() {
  const tenants = await listTenants();

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Clientes (proyectos Supabase) gestionados por VerdFrut"
        action={
          <Link
            href="/tenants/new"
            className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--vf-green-600,#15803d)] px-4 text-sm font-medium text-white hover:bg-[var(--vf-green-700,#14532d)]"
          >
            + Onboardear cliente
          </Link>
        }
      />

      <Card>
        <DataTable
          columns={COLS}
          rows={tenants}
          rowKey={(r) => r.id}
          emptyTitle="Sin tenants registrados"
          emptyDescription="Inserta el primer cliente desde el wizard o vía SQL."
          emptyAction={
            <Link
              href="/tenants/new"
              className="text-sm text-[var(--vf-green-600,#15803d)] hover:underline"
            >
              Onboardear el primero →
            </Link>
          }
        />
      </Card>
    </>
  );
}
