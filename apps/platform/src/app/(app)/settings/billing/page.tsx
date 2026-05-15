// /settings/billing — UI de gestión de suscripción Stripe.
//
// Estados que renderiza:
//   - "Sin suscripción" → botón "Empezar Pro" (lanza checkout)
//   - "Activa" → breakdown + botón "Administrar suscripción" (Customer Portal)
//   - "Past due" / "Canceled" → warning + CTA correspondiente
//
// Toast handling: si la URL trae ?success=1 o ?canceled=1 (de los return URLs
// del checkout), mostramos un toast informativo via el componente cliente.

import { PageHeader, Card, Badge } from '@tripdrive/ui';
import { requireRole } from '@/lib/auth';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { getStripe, getPriceIds } from '@/lib/stripe/client';
import { BillingActions } from './billing-actions';

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

  const [{ data: customer }, adminSeats, driverSeats] = await Promise.all([
    admin
      .from('customers')
      .select(
        'id, name, tier, stripe_subscription_id, subscription_status, subscription_current_period_end, last_synced_admin_seats, last_synced_driver_seats, last_seats_synced_at',
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
  ]);

  const adminCount = adminSeats.count ?? 0;
  const driverCount = driverSeats.count ?? 0;

  const stripeConfigured = getStripe() !== null && getPriceIds() !== null;

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

      {/* Breakdown de seats */}
      <Card className="mb-4 border-[var(--color-border)] bg-[var(--vf-surface-2)] p-4">
        <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
          Seats activos
        </p>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <SeatRow
            label="Admin / dispatcher"
            count={adminCount}
            lastSynced={customer?.last_synced_admin_seats ?? null}
          />
          <SeatRow
            label="Choferes"
            count={driverCount}
            lastSynced={customer?.last_synced_driver_seats ?? null}
          />
        </div>
        {customer?.last_seats_synced_at && (
          <p className="mt-2 text-[11px] text-[var(--color-text-subtle)]">
            Última sincronización con Stripe:{' '}
            {new Date(customer.last_seats_synced_at as string).toLocaleString('es-MX')}
          </p>
        )}
        <p className="mt-2 text-[11px] text-[var(--color-text-muted)]">
          Cuando creas o desactivas un chofer/admin, las quantities se actualizan en Stripe
          con proration automática. El cargo del próximo ciclo refleja el cambio.
        </p>
      </Card>
    </>
  );
}

function SeatRow({
  label,
  count,
  lastSynced,
}: {
  label: string;
  count: number;
  lastSynced: number | null;
}) {
  const drift = lastSynced !== null && lastSynced !== count;
  return (
    <div className="rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
        {label}
      </p>
      <p className="mt-0.5 text-2xl font-semibold text-[var(--color-text)]">{count}</p>
      {drift && (
        <p className="mt-1 text-[10px] text-[var(--color-warning-fg)]">
          ⚠ En Stripe: {lastSynced}. Se sincronizará al siguiente cambio.
        </p>
      )}
    </div>
  );
}
