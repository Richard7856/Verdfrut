// /settings/billing — UI de gestión de suscripción Stripe.
//
// Estados que renderiza:
//   - "Sin suscripción" → botón "Empezar Pro" (lanza checkout)
//   - "Activa" → breakdown + botón "Administrar suscripción" (Customer Portal)
//   - "Past due" / "Canceled" → warning + CTA correspondiente
//
// Toast handling: si la URL trae ?success=1 o ?canceled=1 (de los return URLs
// del checkout), mostramos un toast informativo via el componente cliente.

import Link from 'next/link';
import { PageHeader, Card, Badge } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { getEffectiveFeatures } from '@tripdrive/plans';
import {
  getStripe,
  getPriceIdsForTier,
  getMinimumsForTier,
  computeExtrasFromSeats,
  anyTierConfigured,
  type CustomerTier,
} from '@/lib/stripe/client';
import { BillingActions } from './billing-actions';
import { UsageCard } from './usage-cards';

export const metadata = { title: 'Suscripción y facturación' };
export const dynamic = 'force-dynamic';

interface Props {
  searchParams: Promise<{ success?: string; canceled?: string }>;
}

const STATUS_LABEL: Record<
  string,
  { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  trialing: { text: 'Prueba activa', tone: 'info' },
  active: { text: 'Activa', tone: 'success' },
  past_due: { text: 'Pago atrasado', tone: 'warning' },
  unpaid: { text: 'No pagada', tone: 'danger' },
  canceled: { text: 'Cancelada', tone: 'danger' },
  incomplete: { text: 'Incompleta', tone: 'warning' },
  incomplete_expired: { text: 'Expirada', tone: 'danger' },
  paused: { text: 'Pausada', tone: 'neutral' },
};

export default async function BillingPage({ searchParams }: Props) {
  // Solo admin del customer puede ver/operar billing.
  const profile = await requireRole('admin');
  const { success, canceled } = await searchParams;

  const admin = createServiceRoleClient();

  // Cargar customer + breakdown actual de seats.
  const { data: profileRow } = await admin
    .from('user_profiles')
    .select('customer_id')
    .eq('id', profile.id)
    .maybeSingle();
  const customerId = profileRow?.customer_id as string | undefined;

  if (!customerId) {
    return (
      <>
        <PageHeader title="Suscripción y facturación" />
        <Card className="border-[var(--color-border)] p-6 text-sm text-[var(--color-text-muted)]">
          Tu usuario no está asociado a un customer. Contacta al administrador.
        </Card>
      </>
    );
  }

  // ADR-126: incluimos en la query los campos de cuota AI + status del
  // customer para que `getEffectiveFeatures` resuelva los caps reales (vs
  // tier base, considerando overrides). Y contamos tiendas para el card de
  // consumo de catálogo.
  const [{ data: customer }, adminSeats, driverSeats, storeCount] = await Promise.all([
    admin
      .from('customers')
      .select(
        'id, name, tier, status, feature_overrides, stripe_subscription_id, subscription_status, subscription_current_period_end, last_synced_admin_seats, last_synced_driver_seats, last_seats_synced_at, ai_sessions_used_month, ai_writes_used_month, ai_quota_period_starts_at',
      )
      .eq('id', customerId)
      .maybeSingle(),
    admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('role', ['admin', 'dispatcher'])
      .eq('is_active', true),
    admin
      .from('drivers')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('is_active', true),
    admin
      .from('stores')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('is_active', true)
      .eq('is_sandbox', false),
  ]);

  const adminCount = adminSeats.count ?? 0;
  const driverCount = driverSeats.count ?? 0;
  const storesCount = storeCount.count ?? 0;

  // ADR-126: resolver features efectivos para conocer caps reales.
  const features = customer
    ? getEffectiveFeatures({
        tier: customer.tier as CustomerTier,
        status: (customer.status ?? 'active') as 'active' | 'demo' | 'paused' | 'churned',
        feature_overrides: customer.feature_overrides,
      })
    : null;

  // Próximo reset: 1ro del mes siguiente al período actual.
  const aiPeriodStart = customer?.ai_quota_period_starts_at
    ? new Date(customer.ai_quota_period_starts_at as string)
    : new Date();
  const aiResetsAt = new Date(
    Date.UTC(aiPeriodStart.getUTCFullYear(), aiPeriodStart.getUTCMonth() + 1, 1),
  );
  const resetLabel = aiResetsAt.toLocaleDateString('es-MX', {
    day: 'numeric',
    month: 'long',
  });

  // Stripe configurado = SDK + al menos un tier completo (3 price IDs).
  const customerTier = (customer?.tier as CustomerTier | null) ?? 'pro';
  const stripeConfigured =
    getStripe() !== null &&
    (getPriceIdsForTier(customerTier) !== null || anyTierConfigured());
  const { minAdmins, minDrivers } = getMinimumsForTier(customerTier);

  const status = customer?.subscription_status ?? null;
  const statusInfo = status ? STATUS_LABEL[status] : null;
  const hasActiveSubscription =
    status === 'active' || status === 'trialing' || status === 'past_due';

  return (
    <>
      <PageHeader
        title="Suscripción y facturación"
        description="Tu plan se cobra por seat activo. Cada chofer o admin/dispatcher cuenta como un seat y se sincroniza automáticamente con Stripe."
      />

      <BillingActions
        successFlag={success === '1'}
        canceledFlag={canceled === '1'}
        canCheckout={stripeConfigured && !hasActiveSubscription}
        canPortal={stripeConfigured && Boolean(customer?.stripe_subscription_id)}
      />

      {!stripeConfigured && (
        <Card className="mb-4 border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] p-3">
          <p className="text-sm font-medium text-[var(--color-warning-fg)]">
            ⚠ Stripe no está configurado todavía
          </p>
          <p className="mt-1 text-xs text-[var(--color-warning-fg)]">
            Falta setear <code>STRIPE_SECRET_KEY</code>, <code>STRIPE_PRICE_ID_ADMIN</code> y{' '}
            <code>STRIPE_PRICE_ID_DRIVER</code> en las env vars. La sincronización de seats
            está pausada mientras tanto.
          </p>
        </Card>
      )}

      {/* Status card */}
      <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Estado actual
            </p>
            <div className="mt-1 flex items-center gap-2">
              {statusInfo ? (
                <Badge tone={statusInfo.tone}>{statusInfo.text}</Badge>
              ) : (
                <span className="text-sm text-[var(--color-text-muted)]">Sin suscripción</span>
              )}
              {customer?.tier && (
                <span className="rounded-md border border-[var(--color-border)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                  Plan {customer.tier}
                </span>
              )}
            </div>
            {customer?.subscription_current_period_end && hasActiveSubscription && (
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Próxima factura:{' '}
                <span className="text-[var(--color-text)]">
                  {new Date(customer.subscription_current_period_end as string).toLocaleDateString('es-MX', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Breakdown de seats vs licencia base */}
      {(() => {
        const { extraAdmins, extraDrivers } = computeExtrasFromSeats(adminCount, driverCount, customerTier);
        const tierLabel = customerTier === 'starter' ? 'Operación' : customerTier === 'enterprise' ? 'Enterprise' : 'Pro';
        return (
          <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-4">
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Seats activos
            </p>

            <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">
                    Licencia {tierLabel} base
                  </p>
                  <p className="text-[11px] text-[var(--color-text-muted)]">
                    Incluye hasta {minAdmins} admin + {minDrivers} choferes sin costo extra
                  </p>
                </div>
                <span className="rounded-md bg-[var(--vf-green-950)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--vf-green-300)]">
                  Incluida
                </span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <SeatRow
                label="Admin / dispatcher"
                count={adminCount}
                minIncluded={minAdmins}
                extras={extraAdmins}
                lastSynced={customer?.last_synced_admin_seats ?? null}
              />
              <SeatRow
                label="Choferes"
                count={driverCount}
                minIncluded={minDrivers}
                extras={extraDrivers}
                lastSynced={customer?.last_synced_driver_seats ?? null}
              />
            </div>

            {customer?.last_seats_synced_at && (
              <p className="mt-3 text-[11px] text-[var(--color-text-subtle)]">
                Última sincronización con Stripe:{' '}
                {new Date(customer.last_seats_synced_at as string).toLocaleString('es-MX')}
              </p>
            )}
            <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
              Cuando creas un seat arriba del mínimo, se cobra con proration automática. Si lo
              desactivas, se acredita en la próxima factura.
            </p>
          </Card>
        );
      })()}

      {/* ADR-126: tu consumo este mes — AI sessions + writes + tiendas vs cap. */}
      {features && (
        <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
              Tu consumo este mes
            </p>
            <p className="text-[11px] text-[var(--color-text-muted)]">
              Renueva el {resetLabel}
            </p>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* AI sessions: solo si el plan incluye AI. Para Starter mostramos
                un card "bloqueado" con CTA upgrade. */}
            {features.ai ? (
              <UsageCard
                title="Sesiones AI"
                used={Number(customer?.ai_sessions_used_month ?? 0)}
                limit={features.maxAiSessionsPerMonth}
                unitLabel="sesiones"
                footnote={
                  Number.isFinite(features.maxAiSessionsPerMonth)
                    ? `Renueva el ${resetLabel}`
                    : undefined
                }
                upgradeUrl="/settings/billing"
              />
            ) : (
              <div
                className="flex flex-col justify-center rounded-md border p-3 text-center"
                style={{
                  background: 'var(--vf-surface-1)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <p className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                  Sesiones AI
                </p>
                <p className="mt-1.5 text-base font-semibold" style={{ color: 'var(--color-text-muted)' }}>
                  🔒 No incluido en tu plan
                </p>
                <p className="mt-1 text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  Sube a Pro para 300 sesiones/mes o a Enterprise para ilimitado.
                </p>
              </div>
            )}

            {features.ai && (
              <UsageCard
                title="Acciones AI (creates/updates)"
                used={Number(customer?.ai_writes_used_month ?? 0)}
                limit={features.maxAiWritesPerMonth}
                unitLabel="acciones"
                footnote={
                  Number.isFinite(features.maxAiWritesPerMonth)
                    ? 'Cada vez que el agente crea/modifica algo'
                    : 'Sin tope · ideal para operación pesada'
                }
                upgradeUrl="/settings/billing"
              />
            )}

            <UsageCard
              title="Tiendas activas"
              used={storesCount}
              limit={features.maxStoresPerAccount}
              unitLabel="tiendas"
              footnote={
                Number.isFinite(features.maxStoresPerAccount)
                  ? 'Cap por cuenta operativa'
                  : 'Sin tope en tu plan'
              }
              upgradeUrl="/settings/billing"
            />
          </div>
        </Card>
      )}

      {/* Gestión rápida: links a las páginas existentes de admins/choferes. No
          duplicamos UI de gestión aquí — el admin entra a las páginas
          dedicadas para invitar, desactivar, ver detalles. */}
      <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-4">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Gestionar equipo
        </p>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
          Cada cambio de seat (alta o baja) se cobra/acredita automáticamente con proration en
          tu próxima factura.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Link
            href="/settings/users"
            className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3 text-sm hover:bg-[var(--vf-surface-2)]"
          >
            <div>
              <p className="font-medium text-[var(--color-text)]">
                👥 Admins y dispatchers
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {adminCount} activo{adminCount === 1 ? '' : 's'} · invitar / desactivar
              </p>
            </div>
            <span className="text-[var(--color-text-muted)]">→</span>
          </Link>
          <Link
            href="/drivers"
            className="flex items-center justify-between rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3 text-sm hover:bg-[var(--vf-surface-2)]"
          >
            <div>
              <p className="font-medium text-[var(--color-text)]">
                🚐 Choferes
              </p>
              <p className="text-[11px] text-[var(--color-text-muted)]">
                {driverCount} activo{driverCount === 1 ? '' : 's'} · alta / baja
              </p>
            </div>
            <span className="text-[var(--color-text-muted)]">→</span>
          </Link>
        </div>
      </Card>
    </>
  );
}

function SeatRow({
  label,
  count,
  minIncluded,
  extras,
  lastSynced,
}: {
  label: string;
  count: number;
  minIncluded: number;
  extras: number;
  lastSynced: number | null;
}) {
  const drift = lastSynced !== null && lastSynced !== count;
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold text-[var(--color-text)]">{count}</p>
      <p className="mt-0.5 text-[10px] text-[var(--color-text-muted)]">
        {extras === 0
          ? `Dentro del mínimo (${minIncluded} incluidos)`
          : `+${extras} extra${extras === 1 ? '' : 's'} (sobre ${minIncluded} incluidos)`}
      </p>
      {drift && (
        <p className="mt-1 text-[10px] text-[var(--color-warning-fg)]">
          ⚠ En Stripe: {lastSynced}. Se sincronizará al siguiente cambio.
        </p>
      )}
    </div>
  );
}
