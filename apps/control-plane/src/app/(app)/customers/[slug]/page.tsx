// Detail page de un customer — Fase A2.2.
// Muestra: identidad, comercial, branding, KPIs operativos del tenant
// compartido, audit/notas.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@tripdrive/ui';
import {
  getCustomerBySlug,
  getCustomerOpsCounts,
  type CustomerStatus,
  type CustomerTier,
} from '@/lib/queries/customers';

export const dynamic = 'force-dynamic';

const fmtCurrency = new Intl.NumberFormat('es-MX', {
  style: 'currency',
  currency: 'MXN',
  maximumFractionDigits: 0,
});
const fmtInt = new Intl.NumberFormat('es-MX');
const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-MX', { dateStyle: 'medium' }) : '—';
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });

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

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const customer = await getCustomerBySlug(slug);
  return { title: customer ? customer.name : 'Customer' };
}

export default async function CustomerDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const customer = await getCustomerBySlug(slug);
  if (!customer) notFound();

  const ops = await getCustomerOpsCounts(customer.id);

  const opsKpis = [
    { label: 'Zonas', value: fmtInt.format(ops.zones) },
    { label: 'Depots', value: fmtInt.format(ops.depots) },
    { label: 'Tiendas', value: fmtInt.format(ops.stores) },
    { label: 'Vehículos', value: fmtInt.format(ops.vehicles) },
    { label: 'Choferes', value: fmtInt.format(ops.drivers) },
    { label: 'Users', value: fmtInt.format(ops.users) },
    { label: 'Rutas activas', value: fmtInt.format(ops.activeRoutes) },
    { label: 'Tiros (30d)', value: fmtInt.format(ops.dispatchesLast30d) },
  ];

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`slug: ${customer.slug} · creado ${fmtDate(customer.createdAt)}`}
        breadcrumb={
          <Link href="/customers" className="hover:underline">
            Customers
          </Link>
        }
        action={
          <Link
            href={`/customers/${customer.slug}/edit`}
            className="inline-flex h-10 items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium hover:bg-[var(--color-surface-hover,var(--color-surface))]"
          >
            Editar
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[customer.status]}>{STATUS_LABEL[customer.status]}</Badge>
        <Badge tone="neutral">{TIER_LABEL[customer.tier]}</Badge>
        <span className="text-xs text-[var(--color-text-muted)]">
          Timezone: <code className="font-mono">{customer.timezone}</code>
        </span>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Comercial</h2>
          <DetailRow label="Razón social" value={customer.legalName ?? '—'} />
          <DetailRow label="RFC" value={customer.rfc ? <code>{customer.rfc}</code> : '—'} />
          <DetailRow
            label="MRR contratado"
            value={customer.monthlyFeeMxn !== null ? fmtCurrency.format(customer.monthlyFeeMxn) : '—'}
          />
          <DetailRow
            label="Fee por chofer"
            value={
              customer.perDriverFeeMxn !== null
                ? `${fmtCurrency.format(customer.perDriverFeeMxn)} / mes`
                : '—'
            }
          />
          <DetailRow label="Contrato desde" value={fmtDate(customer.contractStartedAt)} />
          <DetailRow label="Contrato termina" value={fmtDate(customer.contractEndsAt)} />
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Branding</h2>
          <DetailRow
            label="Color primario"
            value={
              customer.brandColorPrimary ? (
                <span className="inline-flex items-center gap-2">
                  <span
                    className="inline-block h-4 w-4 rounded border border-[var(--color-border)]"
                    style={{ background: customer.brandColorPrimary }}
                    aria-hidden
                  />
                  <code className="font-mono text-xs">{customer.brandColorPrimary}</code>
                </span>
              ) : (
                '—'
              )
            }
          />
          <DetailRow
            label="Logo URL"
            value={
              customer.brandLogoUrl ? (
                <a
                  href={customer.brandLogoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs text-[var(--vf-green-600,#15803d)] hover:underline"
                >
                  {customer.brandLogoUrl}
                </a>
              ) : (
                '—'
              )
            }
          />
          <p className="mt-4 text-xs text-[var(--color-text-muted)]">
            Aplicación efectiva en apps web + native: Fase A4 (pendiente).
          </p>
        </Card>
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        KPIs operativos
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {opsKpis.map((k) => (
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
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-text)]">Audit & notas</h2>
        <DetailRow label="Creado" value={fmtDateTime(customer.createdAt)} />
        <DetailRow label="Actualizado" value={fmtDateTime(customer.updatedAt)} />
        <DetailRow
          label="Notas"
          value={
            customer.notes ? (
              <p className="whitespace-pre-wrap text-sm">{customer.notes}</p>
            ) : (
              <span className="text-[var(--color-text-muted)]">—</span>
            )
          }
        />
      </Card>
    </>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] py-2 last:border-b-0">
      <span className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </span>
      <span className="text-right text-sm text-[var(--color-text)]">{value}</span>
    </div>
  );
}
