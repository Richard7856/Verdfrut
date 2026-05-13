// Lista de customers (multi-tenancy INTERNA — modelo #2 del plan híbrido).
// Fase A2 de Stream A. Lee customers del tenant project shared via service_role
// (bypass RLS — el control plane es super-admin TripDrive cross-customer).

import Link from 'next/link';
import { PageHeader, Card, Badge, DataTable, type Column } from '@tripdrive/ui';
import {
  listCustomers,
  getCustomersAggregate,
  type Customer,
  type CustomerStatus,
  type CustomerTier,
} from '@/lib/queries/customers';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtInt = new Intl.NumberFormat('es-MX');

const STATUS_TONE: Record<CustomerStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  demo: 'warning',
  paused: 'warning',
  churned: 'danger',
};

const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Activo',
  demo: 'Demo',
  paused: 'Pausado',
  churned: 'Churned',
};

const TIER_LABEL: Record<CustomerTier, string> = {
  starter: 'Starter',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const COLS: Column<Customer>[] = [
  {
    key: 'name',
    header: 'Cliente',
    cell: (r) => (
      <Link
        href={`/customers/${r.slug}`}
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
    key: 'tier',
    header: 'Tier',
    cell: (r) => <span>{TIER_LABEL[r.tier]}</span>,
  },
  {
    key: 'timezone',
    header: 'Timezone',
    cell: (r) => <span className="text-xs text-[var(--color-text-muted)]">{r.timezone}</span>,
  },
  {
    key: 'mrr',
    header: 'MRR',
    align: 'right',
    cell: (r) => (
      <span className="tabular-nums">
        {r.monthlyFeeMxn !== null ? fmtCurrency.format(r.monthlyFeeMxn) : '—'}
      </span>
    ),
  },
  {
    key: 'contract',
    header: 'Contrato desde',
    align: 'right',
    cell: (r) => (
      <span className="text-xs text-[var(--color-text-muted)] tabular-nums">
        {r.contractStartedAt
          ? new Date(r.contractStartedAt).toLocaleDateString('es-MX')
          : '—'}
      </span>
    ),
  },
];

export default async function CustomersPage() {
  const [customers, agg] = await Promise.all([
    listCustomers(),
    getCustomersAggregate(),
  ]);

  const kpis = [
    { label: 'Activos', value: fmtInt.format(agg.byStatus.active) },
    { label: 'Demo', value: fmtInt.format(agg.byStatus.demo) },
    { label: 'Pausados', value: fmtInt.format(agg.byStatus.paused) },
    { label: 'MRR activo', value: fmtCurrency.format(agg.totalMonthlyFee) },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Clientes multi-tenant dentro del proyecto Supabase compartido (modelo #2 del plan)."
        action={
          <Link
            href="/customers/new"
            className="inline-flex h-10 items-center rounded-[var(--radius-md)] bg-[var(--vf-green-600,#15803d)] px-4 text-sm font-medium text-white hover:bg-[var(--vf-green-700,#14532d)]"
          >
            + Nuevo customer
          </Link>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <DataTable
          columns={COLS}
          rows={customers}
          rowKey={(r) => r.id}
          emptyTitle="Sin customers registrados"
          emptyDescription="Crea el primer customer desde el botón superior o vía SQL seed."
        />
      </Card>
    </>
  );
}
