// POST /api/billing/checkout — crea Stripe Checkout Session (mode=subscription)
// con 2 line items: admin seat + driver seat. Cuenta los seats actuales del
// customer del caller y los pasa como quantity inicial.
//
// Flow:
//  1. requireRole admin (sólo admin del customer puede iniciar billing).
//  2. Si el customer ya tiene stripe_subscription_id activa → redirect al
//     Customer Portal en vez de checkout duplicado.
//  3. Si no tiene stripe_customer_id → crear uno en Stripe.
//  4. Crear Checkout Session subscription mode con success_url y cancel_url.
//  5. Devolver { url } para que el cliente haga window.location = url.
//
// Manejo de errores: si Stripe falla, devolvemos 500 con mensaje legible.
// El admin verá un toast en /settings/billing y puede reintentar.

import 'server-only';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import {
  requireStripe,
  requirePriceIdsForTier,
  getReturnUrls,
  computeExtrasFromSeats,
  type CustomerTier,
} from '@/lib/stripe/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  // Sólo admin (no dispatcher) puede iniciar checkout — billing es decisión
  // del owner del customer.
  const profile = await requireRole('admin');

  let stripe;
  let urls;
  try {
    stripe = requireStripe();
    urls = getReturnUrls();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stripe no configurado' },
      { status: 500 },
    );
  }

  const admin = createServiceRoleClient();

  // 1. Resolver customer_id del caller. UserProfile no lo trae directo;
  //    lo leemos de user_profiles. Service role aquí es OK porque el caller
  //    ya pasó requireRole('admin').
  const { data: profileRow, error: pErr } = await admin
    .from('user_profiles')
    .select('customer_id, email')
    .eq('id', profile.id)
    .maybeSingle();
  if (pErr || !profileRow?.customer_id) {
    return NextResponse.json(
      { error: 'Tu usuario no está asociado a un customer.' },
      { status: 400 },
    );
  }
  const customerId = profileRow.customer_id as string;

  const { data: customer, error: cErr } = await admin
    .from('customers')
    .select(
      'id, name, tier, stripe_customer_id, stripe_subscription_id, subscription_status',
    )
    .eq('id', customerId)
    .maybeSingle();
  if (cErr || !customer) {
    return NextResponse.json(
      { error: `No se pudo cargar el customer: ${cErr?.message ?? 'no encontrado'}` },
      { status: 500 },
    );
  }

  // Resolver price IDs del tier de este customer.
  const customerTier = (customer.tier as CustomerTier | null) ?? 'pro';
  let priceIds;
  try {
    priceIds = requirePriceIdsForTier(customerTier);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Tier sin configurar' },
      { status: 500 },
    );
  }

  // 2. Si ya tiene subscription activa, mandamos al Customer Portal.
  if (
    customer.stripe_subscription_id &&
    (customer.subscription_status === 'active' ||
      customer.subscription_status === 'trialing' ||
      customer.subscription_status === 'past_due')
  ) {
    if (!customer.stripe_customer_id) {
      return NextResponse.json(
        { error: 'Subscription existente sin stripe_customer_id — inconsistencia.' },
        { status: 500 },
      );
    }
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: customer.stripe_customer_id,
        return_url: urls.success.replace('?success=1', ''),
      });
      return NextResponse.json({ url: portal.url, mode: 'portal' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear sesión del portal';
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // 3. Crear o reusar stripe_customer_id.
  let stripeCustomerId = customer.stripe_customer_id;
  if (!stripeCustomerId) {
    try {
      const created = await stripe.customers.create({
        name: customer.name ?? undefined,
        email: profileRow.email ?? undefined,
        metadata: {
          tripdrive_customer_id: customer.id as string,
        },
      });
      stripeCustomerId = created.id;
      await admin
        .from('customers')
        .update({ stripe_customer_id: stripeCustomerId })
        .eq('id', customer.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al crear customer en Stripe';
      logger.error('stripe.checkout.create_customer_failed', { customer_id: customer.id, err: msg });
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // 4. Contar seats actuales y derivar EXTRAS sobre el mínimo incluido en
  //    la licencia Pro base (2 admins + 5 choferes incluidos sin costo extra).
  const [adminRes, driverRes] = await Promise.all([
    admin
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id)
      .in('role', ['admin', 'dispatcher'])
      .eq('is_active', true),
    admin
      .from('drivers')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', customer.id)
      .eq('is_active', true),
  ]);
  const { extraAdmins, extraDrivers } = computeExtrasFromSeats(
    adminRes.count ?? 0,
    driverRes.count ?? 0,
    customerTier,
  );

  // 5. Crear Checkout Session subscription mode con 3 line items: base
  //    (siempre × 1) + extras (× N sobre el mínimo).
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        { price: priceIds.base, quantity: 1 },
        { price: priceIds.extraAdmin, quantity: extraAdmins },
        { price: priceIds.extraDriver, quantity: extraDrivers },
      ],
      success_url: urls.success,
      cancel_url: urls.cancel,
      subscription_data: {
        metadata: {
          tripdrive_customer_id: customer.id as string,
        },
      },
      // Permite que el cliente edite cantidades en el checkout — útil si
      // quieren pagar por más seats que los actualmente registrados.
      allow_promotion_codes: true,
    });
    return NextResponse.json({ url: session.url, mode: 'checkout' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error al crear checkout';
    logger.error('stripe.checkout.create_session_failed', { customer_id: customer.id, err: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
