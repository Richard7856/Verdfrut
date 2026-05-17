// Detail page de un customer — Fase A2.2.
// Muestra: identidad, comercial, branding, KPIs operativos del tenant
// compartido, audit/notas.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card, Badge } from '@tripdrive/ui';
import {
  getCustomerBySlug,
  getCustomerOpsCounts,
  getCustomerOpsToday,
  listActiveRoutesForCustomer,
  listPendingDispatchesForCustomer,
  type CustomerStatus,
  type CustomerTier,
  type ActiveRouteRow,
  type PendingDispatchRow,
} from '@/lib/queries/customers';
import {
  PLAN_FEATURES,
  PLAN_LABELS,
  TOGGLEABLE_FEATURE_KEYS,
  getEffectiveFeatures,
  type FeatureKey,
} from '@tripdrive/plans';

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
const TIER_LABEL: Record<CustomerTier, string> = PLAN_LABELS;

const FEATURE_LABEL_SHORT: Record<FeatureKey, string> = {
  ai: 'Asistente AI',
  maxAiSessionsPerMonth: 'Sesiones AI/mes',
  maxAiWritesPerMonth: 'Acciones AI/mes',
  maxAccounts: 'Cuentas operativas',
  maxStoresPerAccount: 'Tiendas por cuenta',
  customDomain: 'Dominio propio',
  customBranding: 'Branding propio',
  xlsxImport: 'Import XLSX',
  dragEditMap: 'Mapa drag-to-edit',
  pushNotifications: 'Push notifications',
  liveReOpt: 'Re-opt en vivo',
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

  // Ola 1 / A3-ops: vista de operación del customer hoy.
  const [ops, opsToday, activeRoutes, pendingDispatches] = await Promise.all([
    getCustomerOpsCounts(customer.id),
    getCustomerOpsToday(customer.id, customer.timezone),
    listActiveRoutesForCustomer(customer.id, customer.timezone),
    listPendingDispatchesForCustomer(customer.id, customer.timezone),
  ]);

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

      {/* ADR-095: Features efectivas — qué tiene este customer hoy. */}
      <Card className="mb-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">
            Features habilitadas
          </h2>
          <span className="text-xs text-[var(--color-text-muted)]">
            Plan: <strong>{TIER_LABEL[customer.tier]}</strong>
            {customer.status !== 'active' && customer.status !== 'demo' && (
              <> · <span className="text-[var(--vf-warn,#d97706)]">{STATUS_LABEL[customer.status]} (features mínimas)</span></>
            )}
          </span>
        </div>
        <FeaturesGrid customer={customer} />
      </Card>

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

      {/* Ola 1 / A3-ops: vista de operación HOY del customer. */}
      <h2 className="mb-2 flex items-baseline justify-between text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <span>Operación hoy</span>
        <span className="text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-muted)]">
          {fmtDate(opsToday.date)} · tz {customer.timezone}
        </span>
      </h2>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Rutas activas', value: fmtInt.format(opsToday.activeRoutesToday) },
          { label: 'Choferes en ruta', value: fmtInt.format(opsToday.driversInRouteToday) },
          { label: 'Paradas completadas', value: fmtInt.format(opsToday.stopsCompletedToday) },
          { label: 'Paradas pendientes', value: fmtInt.format(opsToday.stopsPendingToday) },
          {
            label: 'Incidencias abiertas',
            value: fmtInt.format(opsToday.openIncidentsToday),
            tone: opsToday.openIncidentsToday > 0 ? 'warn' : undefined,
          },
          { label: 'Tiros por publicar', value: fmtInt.format(opsToday.pendingDispatches) },
        ].map((k) => (
          <Card key={k.label}>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              {k.label}
            </p>
            <p
              className="mt-2 text-2xl font-semibold tabular-nums"
              style={{
                color:
                  k.tone === 'warn'
                    ? 'var(--vf-warn, #d97706)'
                    : 'var(--color-text)',
              }}
            >
              {k.value}
            </p>
          </Card>
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Rutas activas
      </h2>
      <Card className="mb-6">
        {activeRoutes.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
            Sin rutas activas hoy.
          </p>
        ) : (
          <ActiveRoutesTable rows={activeRoutes} customerSlug={customer.slug} />
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Tiros por publicar (próximos)
      </h2>
      <Card className="mb-6">
        {pendingDispatches.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">
            Sin tiros pendientes.
          </p>
        ) : (
          <PendingDispatchesTable rows={pendingDispatches} />
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        Inventario operativo
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

function ActiveRoutesTable({ rows, customerSlug }: {
  rows: ActiveRouteRow[];
  customerSlug: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="py-2 pr-3 font-medium">Ruta</th>
            <th className="py-2 pr-3 font-medium">Chofer</th>
            <th className="py-2 pr-3 font-medium">Vehículo</th>
            <th className="py-2 pr-3 font-medium">Estado</th>
            <th className="py-2 pr-3 text-right font-medium">Progreso</th>
            <th className="py-2 pr-3 text-right font-medium">Incidencias</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pct = r.totalStops > 0
              ? Math.round((r.completedStops / r.totalStops) * 100)
              : 0;
            return (
              <tr
                key={r.id}
                className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-surface-hover,transparent)]"
              >
                <td className="py-2 pr-3">
                  <Link
                    href={`/customers/${customerSlug}/routes/${r.id}`}
                    className="font-medium text-[var(--color-text)] hover:text-[var(--vf-green-600,#15803d)]"
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                  {r.driverName ?? '—'}
                </td>
                <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                  {r.vehiclePlate ? <code className="font-mono">{r.vehiclePlate}</code> : '—'}
                </td>
                <td className="py-2 pr-3">
                  <Badge tone={r.status === 'IN_PROGRESS' ? 'success' : 'warning'}>
                    {r.status === 'IN_PROGRESS' ? 'En ruta' : 'Publicada'}
                  </Badge>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  <span>
                    {r.completedStops}/{r.totalStops}
                  </span>
                  <span className="ml-2 text-xs text-[var(--color-text-muted)]">
                    ({pct}%)
                  </span>
                  {r.arrivedStops > 0 && (
                    <span className="ml-2 text-xs text-[var(--vf-warn,#d97706)]">
                      {r.arrivedStops} en parada
                    </span>
                  )}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {r.openIncidents > 0 ? (
                    <Badge tone="danger">{r.openIncidents}</Badge>
                  ) : (
                    <span className="text-[var(--color-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PendingDispatchesTable({ rows }: { rows: PendingDispatchRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="py-2 pr-3 font-medium">Tiro</th>
            <th className="py-2 pr-3 font-medium">Fecha</th>
            <th className="py-2 pr-3 text-right font-medium">Rutas</th>
            <th className="py-2 pr-3 text-right font-medium">Paradas</th>
            <th className="py-2 pr-3 font-medium">Notas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr
              key={d.id}
              className="border-b border-[var(--color-border)] last:border-b-0"
            >
              <td className="py-2 pr-3 font-medium text-[var(--color-text)]">{d.name}</td>
              <td className="py-2 pr-3 text-[var(--color-text-muted)] tabular-nums">
                {fmtDate(d.date)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{d.routeCount}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{d.storeCount}</td>
              <td className="py-2 pr-3 text-[var(--color-text-muted)]">
                {d.notes ? (
                  <span title={d.notes}>{d.notes.slice(0, 60)}{d.notes.length > 60 ? '…' : ''}</span>
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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

/**
 * Grid de features efectivas — read-only.
 *
 * Para cada feature toggleable muestra: ✓ (on) / × (off), y un mini-marcador
 * si está sobrescrita vs heredada del tier. Los límites numéricos
 * (maxAccounts, maxStores) se muestran como número.
 */
function FeaturesGrid({
  customer,
}: {
  customer: {
    tier: CustomerTier;
    status: CustomerStatus;
    featureOverrides: Record<string, unknown>;
  };
}) {
  const effective = getEffectiveFeatures({
    tier: customer.tier,
    status: customer.status,
    feature_overrides: customer.featureOverrides,
  });
  const tierBase = PLAN_FEATURES[customer.tier];

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {TOGGLEABLE_FEATURE_KEYS.map((key) => {
        const on = Boolean(effective[key]);
        const overridden = customer.featureOverrides[String(key)] !== undefined;
        const tierDefault = Boolean(tierBase[key]);
        return (
          <div
            key={String(key)}
            className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm"
          >
            <div className="flex flex-col">
              <span className="text-[var(--color-text)]">{FEATURE_LABEL_SHORT[key]}</span>
              {overridden && (
                <span className="text-[10px] text-[var(--vf-warn,#d97706)]">
                  override · tier default {tierDefault ? 'on' : 'off'}
                </span>
              )}
            </div>
            <span
              className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                on
                  ? 'bg-[color-mix(in_oklch,var(--color-success,#10b981)_20%,transparent)] text-[var(--color-success,#10b981)]'
                  : 'bg-[var(--color-surface-muted,#1f2421)] text-[var(--color-text-muted)]'
              }`}
              aria-label={on ? 'habilitada' : 'deshabilitada'}
            >
              {on ? '✓' : '×'}
            </span>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <span className="text-[var(--color-text)]">Cuentas operativas (máx)</span>
        <span className="font-mono text-[var(--color-text)]">
          {effective.maxAccounts === Infinity ? '∞' : effective.maxAccounts}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
        <span className="text-[var(--color-text)]">Tiendas por cuenta (máx)</span>
        <span className="font-mono text-[var(--color-text)]">
          {effective.maxStoresPerAccount === Infinity ? '∞' : effective.maxStoresPerAccount}
        </span>
      </div>
    </div>
  );
}
