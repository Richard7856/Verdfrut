import 'server-only';

// syncSeats(customerId): cuenta los seats activos del customer y actualiza
// la quantity de cada line item en su Stripe Subscription. Es best-effort:
//
//  - Si Stripe no está configurado → no-op silencioso (deploy sin env vars).
//  - Si el customer no tiene subscription_id (no completó checkout todavía)
//    → no-op silencioso. El admin verá un banner en /settings/billing
//    invitándolo a empezar Pro.
//  - Si Stripe responde 4xx/5xx → loggeamos al audit con stripe_error pero
//    NO tiramos error al caller. El flujo del usuario (crear chofer)
//    NUNCA debe romperse por billing.
//
// Diseño defensivo intencional: el billing es importante pero secundario.
// Romper la operación porque Stripe está caído sería peor que cobrar de
// menos por unas horas; al estar al día con el siguiente sync se corrige.

import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import {
  getStripe,
  getPriceIdsForTier,
  computeExtrasFromSeats,
  type CustomerTier,
} from './client';

export type SyncReason =
  | 'driver_created'
  | 'driver_deactivated'
  | 'driver_reactivated'
  | 'driver_archived'
  | 'user_promoted'
  | 'user_demoted'
  | 'user_deactivated'
  | 'manual'
  | 'webhook'
  | 'periodic';

export interface SyncSeatsResult {
  ok: boolean;
  /** False si saltamos (no Stripe config / no subscription). */
  skipped: boolean;
  skipReason?: string;
  prevAdmin?: number;
  newAdmin?: number;
  prevDriver?: number;
  newDriver?: number;
  error?: string;
}

interface SyncSeatsOptions {
  customerId: string;
  reason: SyncReason;
  /** UUID del user_profile que disparó el cambio (opcional, para audit). */
  triggeredBy?: string | null;
}

/**
 * Cuenta seats activos y actualiza Stripe. Llamar después del INSERT/UPDATE
 * pero ANTES de devolver al usuario (sincrónico es OK — la latencia de
 * Stripe es ~300-800ms; aceptable).
 */
export async function syncSeats(opts: SyncSeatsOptions): Promise<SyncSeatsResult> {
  const stripe = getStripe();
  if (!stripe) {
    return { ok: true, skipped: true, skipReason: 'stripe_not_configured' };
  }

  const admin = createServiceRoleClient();

  // 1. Cargar customer + tier + subscription_id + last_synced. El tier es
  //    crítico porque define qué set de price IDs y qué mínimos aplican.
  const { data: customer, error: cErr } = await admin
    .from('customers')
    .select(
      'id, tier, stripe_subscription_id, last_synced_admin_seats, last_synced_driver_seats',
    )
    .eq('id', opts.customerId)
    .maybeSingle();
  if (cErr || !customer) {
    return { ok: false, skipped: false, error: cErr?.message ?? 'customer no encontrado' };
  }
  if (!customer.stripe_subscription_id) {
    return { ok: true, skipped: true, skipReason: 'no_active_subscription' };
  }

  // Resolver price IDs del tier del customer. Si el tier no está
  // configurado (env vars faltantes para ese tier), salimos limpio.
  const tier = (customer.tier as CustomerTier | null) ?? 'pro';
  const priceIds = getPriceIdsForTier(tier);
  if (!priceIds) {
    return {
      ok: true,
      skipped: true,
      skipReason: `price_ids_not_configured_for_tier_${tier}`,
    };
  }

  // 2. Contar seats activos por tipo. Las queries son baratas (RLS con
  //    customer_id + is_active indexado) — ~5-20ms.
  //
  //    Admin seats = user_profiles con role IN ('admin','dispatcher') AND is_active.
  //    Driver seats = drivers IS_ACTIVE (la tabla drivers ya está scoped por customer).
  // ADR-112: drivers/admins sandbox NO cuentan para Stripe — son hipotéticos
  // del modo planeación, no consumen seats reales. user_profiles no tiene
  // is_sandbox por ahora (no se "agregan" admins hipotéticos en WB-1 MVP).
  const [adminRes, driverRes] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', opts.customerId)
      .in('role', ['admin', 'dispatcher'])
      .eq('is_active', true),
    admin
      .from('drivers')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', opts.customerId)
      .eq('is_active', true)
      .eq('is_sandbox', false),
  ]);
  if (adminRes.error || driverRes.error) {
    return {
      ok: false,
      skipped: false,
      error: adminRes.error?.message ?? driverRes.error?.message,
    };
  }
  const newAdmin = adminRes.count ?? 0;
  const newDriver = driverRes.count ?? 0;
  const prevAdmin = customer.last_synced_admin_seats ?? 0;
  const prevDriver = customer.last_synced_driver_seats ?? 0;

  // Si nada cambió, no llamamos a Stripe. Esto importa porque drivers/admin
  // server actions disparan syncSeats incluso en updates triviales (ej.
  // cambiar nombre del chofer). Sin este short-circuit, una sesión típica
  // del dispatcher dispararía 20-30 calls inútiles a Stripe.
  if (newAdmin === prevAdmin && newDriver === prevDriver) {
    return {
      ok: true,
      skipped: true,
      skipReason: 'no_change',
      prevAdmin,
      newAdmin,
      prevDriver,
      newDriver,
    };
  }

  // 3. Calcular EXTRAS sobre el mínimo del tier del customer. El piso lo
  //    cubre la base; solo los excedentes suben quantity en Stripe.
  const { extraAdmins, extraDrivers } = computeExtrasFromSeats(newAdmin, newDriver, tier);

  // 4. Fetch subscription para conocer los item IDs. La subscription puede
  //    NO tener los line items de extras todavía si el customer arrancó con
  //    solo la base (signup nuevo) — Stripe no acepta quantity 0 al crear,
  //    así que los extras se OMITEN del checkout inicial. syncSeats agrega
  //    el line item dinámicamente la primera vez que el customer cruza el
  //    mínimo, y los REMUEVE cuando vuelve a estar bajo.
  //
  // Patrón Stripe correcto:
  //  - Agregar item:   { price, quantity }                 (sin id)
  //  - Update qty:     { id: item.id, quantity }            (≥ 1)
  //  - Remover item:   { id: item.id, deleted: true }
  let stripeError: string | undefined;
  try {
    const sub = await stripe.subscriptions.retrieve(customer.stripe_subscription_id);
    const baseItem = sub.items.data.find((it) => it.price.id === priceIds.base);
    const extraAdminItem = sub.items.data.find((it) => it.price.id === priceIds.extraAdmin);
    const extraDriverItem = sub.items.data.find((it) => it.price.id === priceIds.extraDriver);

    if (!baseItem) {
      stripeError = `Subscription ${customer.stripe_subscription_id} no tiene el line item base — config inconsistente.`;
    } else {
      type SubItemMutation =
        | { id: string; quantity: number }
        | { id: string; deleted: true }
        | { price: string; quantity: number };
      const items: SubItemMutation[] = [
        { id: baseItem.id, quantity: 1 },
      ];

      // Admin extra: agregar / actualizar / borrar según el nuevo conteo.
      if (extraAdmins > 0 && extraAdminItem) {
        items.push({ id: extraAdminItem.id, quantity: extraAdmins });
      } else if (extraAdmins > 0 && !extraAdminItem) {
        items.push({ price: priceIds.extraAdmin, quantity: extraAdmins });
      } else if (extraAdmins === 0 && extraAdminItem) {
        items.push({ id: extraAdminItem.id, deleted: true });
      }
      // Driver extra: misma lógica.
      if (extraDrivers > 0 && extraDriverItem) {
        items.push({ id: extraDriverItem.id, quantity: extraDrivers });
      } else if (extraDrivers > 0 && !extraDriverItem) {
        items.push({ price: priceIds.extraDriver, quantity: extraDrivers });
      } else if (extraDrivers === 0 && extraDriverItem) {
        items.push({ id: extraDriverItem.id, deleted: true });
      }

      // UPDATE atómico con proration ON. Stripe genera el prorate
      // automáticamente — el cliente ve el diff en su próxima factura.
      await stripe.subscriptions.update(customer.stripe_subscription_id, {
        items: items as never,
        proration_behavior: 'create_prorations',
      });
    }
  } catch (err) {
    stripeError = err instanceof Error ? err.message : String(err);
  }

  // 5. Actualizar cache local + audit (siempre, aunque Stripe haya fallado —
  //    el audit registra el intento con el error).
  await admin
    .from('customers')
    .update({
      last_synced_admin_seats: stripeError ? prevAdmin : newAdmin,
      last_synced_driver_seats: stripeError ? prevDriver : newDriver,
      last_seats_synced_at: new Date().toISOString(),
    })
    .eq('id', opts.customerId);

  // Audit: insertamos UNA fila por seat type SOLO si cambió. Si solo cambió
  // admin, no metemos ruido en el log de drivers.
  const auditRows: Array<{
    customer_id: string;
    seat_type: 'admin' | 'driver';
    prev_quantity: number;
    new_quantity: number;
    reason: string;
    triggered_by: string | null;
    stripe_error: string | null;
  }> = [];
  if (newAdmin !== prevAdmin) {
    auditRows.push({
      customer_id: opts.customerId,
      seat_type: 'admin',
      prev_quantity: prevAdmin,
      new_quantity: newAdmin,
      reason: opts.reason,
      triggered_by: opts.triggeredBy ?? null,
      stripe_error: stripeError ?? null,
    });
  }
  if (newDriver !== prevDriver) {
    auditRows.push({
      customer_id: opts.customerId,
      seat_type: 'driver',
      prev_quantity: prevDriver,
      new_quantity: newDriver,
      reason: opts.reason,
      triggered_by: opts.triggeredBy ?? null,
      stripe_error: stripeError ?? null,
    });
  }
  if (auditRows.length > 0) {
    await admin.from('billing_seats_audit').insert(auditRows as never);
  }

  if (stripeError) {
    logger.error('stripe.sync_seats.failed', {
      customer_id: opts.customerId,
      reason: opts.reason,
      error: stripeError,
      prev_admin: prevAdmin,
      new_admin: newAdmin,
      prev_driver: prevDriver,
      new_driver: newDriver,
    });
    return {
      ok: false,
      skipped: false,
      prevAdmin,
      newAdmin,
      prevDriver,
      newDriver,
      error: stripeError,
    };
  }

  logger.info('stripe.sync_seats.ok', {
    customer_id: opts.customerId,
    reason: opts.reason,
    admin: `${prevAdmin}→${newAdmin}`,
    driver: `${prevDriver}→${newDriver}`,
  });

  return {
    ok: true,
    skipped: false,
    prevAdmin,
    newAdmin,
    prevDriver,
    newDriver,
  };
}

/**
 * Wrapper "fire-and-forget" para call-sites donde no queremos que la latencia
 * de Stripe afecte la UX del dispatcher. El sync corre en background; si
 * falla, queda en el audit log y un cron periódico puede re-intentar.
 *
 * NO usar en webhooks o flujos donde el resultado importe.
 */
export function syncSeatsBackground(opts: SyncSeatsOptions): void {
  // void-await intencional: queremos disparar sin esperar.
  syncSeats(opts).catch((err) => {
    logger.error('stripe.sync_seats.background_unhandled', {
      customer_id: opts.customerId,
      err: err instanceof Error ? err.message : String(err),
    });
  });
}
