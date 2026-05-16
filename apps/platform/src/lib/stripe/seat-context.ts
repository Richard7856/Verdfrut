import 'server-only';

// Contexto de billing seats para UIs que necesitan saber "¿esta invitación
// dispara cobro extra?" antes de mandar el form (overage warnings, ADR-111).
//
// Diseño:
//   - Una sola query batch para customer + counts. Latencia ~30ms.
//   - Falla silenciosa si el customer no tiene tier o no tiene subscription
//     (ej. trial activo) — devuelve null y la UI no muestra el warning.
//   - NO toca Stripe. Solo BD local + constantes del tier. La cron diaria
//     (`/api/cron/sync-stripe-seats`) ya garantiza que `last_synced_*_seats`
//     refleje la realidad de Stripe con drift máximo 24h.

import { createServerClient } from '@tripdrive/supabase/server';
import {
  getMinimumsForTier,
  getExtraCostsForTier,
  type CustomerTier,
} from './client';

export interface BillingSeatsContext {
  tier: CustomerTier;
  /** Seats actuales (mismo conteo que usa syncSeats). */
  adminSeats: number;
  driverSeats: number;
  /** Pisos incluidos en la base del tier. */
  minAdmins: number;
  minDrivers: number;
  /** Costo MXN/mes de un seat extra del tier. */
  extraAdminCostMxn: number;
  extraDriverCostMxn: number;
  /** TRUE si el customer ya está en una subscription Stripe live. */
  hasActiveSubscription: boolean;
}

/**
 * Carga el contexto de seats del customer actual. Devuelve `null` cuando el
 * customer no está identificable (caller sin customer_id), no tiene tier
 * (sesiones legacy pre-migración tier), o cuando billing no está configurado
 * — en todos esos casos la UI debe esconder el warning silenciosamente.
 */
export async function getBillingSeatsContext(
  customerId: string,
): Promise<BillingSeatsContext | null> {
  const supabase = await createServerClient();

  const { data: customer } = await supabase
    .from('customers')
    .select('tier, stripe_subscription_id')
    .eq('id', customerId)
    .maybeSingle();

  if (!customer || !customer.tier) return null;

  const tier = customer.tier as CustomerTier;
  const { minAdmins, minDrivers } = getMinimumsForTier(tier);
  const { extraAdminCostMxn, extraDriverCostMxn } = getExtraCostsForTier(tier);

  const [adminRes, driverRes] = await Promise.all([
    supabase
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('role', ['admin', 'dispatcher'])
      .eq('is_active', true),
    supabase
      .from('drivers')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .eq('is_active', true),
  ]);

  return {
    tier,
    adminSeats: adminRes.count ?? 0,
    driverSeats: driverRes.count ?? 0,
    minAdmins,
    minDrivers,
    extraAdminCostMxn,
    extraDriverCostMxn,
    hasActiveSubscription: customer.stripe_subscription_id != null,
  };
}
