// POST /api/billing/webhook — recibe eventos de Stripe y actualiza customers.
//
// Eventos procesados:
//   - checkout.session.completed → primera vez que el customer paga. Asocia
//     subscription_id al customer y dispara sync inicial de seats.
//   - customer.subscription.updated → cualquier cambio (renewal, quantity
//     update, plan change). Actualiza status + period_end.
//   - customer.subscription.deleted → customer canceló. Marca status y deja
//     que la UI muestre warning de "tu suscripción terminó el X".
//   - invoice.paid → renueva el ciclo. Importante para period_end.
//   - invoice.payment_failed → status pasa a past_due. UI muestra warning rojo.
//
// Seguridad: verificamos la firma con STRIPE_WEBHOOK_SECRET. Si la firma
// no valida, devolvemos 401 sin procesar — un attacker que adivine el
// endpoint no puede crear/actualizar customers.
//
// Idempotencia: Stripe re-envía si no respondemos 200 en <30s. Cada evento
// trae event.id; podríamos cachearlos en una tabla `processed_stripe_events`
// para idempotencia hard, pero los UPDATEs que hacemos son ya idempotentes
// (last-write-wins sobre los mismos campos). Phase 2 si vemos problemas.

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import { getStripe } from '@/lib/stripe/client';
import { syncSeats } from '@/lib/stripe/sync-seats';
import type Stripe from 'stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Stripe requiere el RAW body (sin parsing JSON) para verificar la firma.
// Next.js Route Handlers leen el body como stream, así que llamamos
// `await req.text()` y se lo pasamos a constructEvent.

export async function POST(req: NextRequest): Promise<NextResponse> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json(
      { error: 'Stripe webhook no configurado.' },
      { status: 503 },
    );
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 401 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid signature';
    logger.warn('stripe.webhook.bad_signature', { err: msg });
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const admin = createServiceRoleClient();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const stripeCustomerId =
          typeof session.customer === 'string' ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;

        // tripdrive_customer_id viene en el metadata que setteamos al crear
        // el Stripe customer. Si no está, lo resolvemos por stripe_customer_id.
        const tripdriveCustomerId =
          (session.metadata?.tripdrive_customer_id as string | undefined) ??
          (await resolveCustomerByStripeId(admin, stripeCustomerId ?? null));

        if (!tripdriveCustomerId || !subscriptionId) {
          logger.error('stripe.webhook.checkout_no_customer', {
            event_id: event.id,
            stripe_customer_id: stripeCustomerId,
          });
          break;
        }

        // Fetch subscription para period_end + status.
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await admin
          .from('customers')
          .update({
            stripe_customer_id: stripeCustomerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: sub.status,
            subscription_current_period_end: subscriptionItemPeriodEnd(sub),
          })
          .eq('id', tripdriveCustomerId);

        // Sync inicial de quantities — el checkout ya creó las cantidades
        // correctas, pero llamamos sync para poblar last_synced_* y el audit.
        await syncSeats({
          customerId: tripdriveCustomerId,
          reason: 'webhook',
        });
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const tripdriveCustomerId =
          (sub.metadata?.tripdrive_customer_id as string | undefined) ??
          (await resolveCustomerBySubscriptionId(admin, sub.id));
        if (!tripdriveCustomerId) break;
        await admin
          .from('customers')
          .update({
            subscription_status: sub.status,
            subscription_current_period_end: subscriptionItemPeriodEnd(sub),
          })
          .eq('id', tripdriveCustomerId);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const tripdriveCustomerId =
          (sub.metadata?.tripdrive_customer_id as string | undefined) ??
          (await resolveCustomerBySubscriptionId(admin, sub.id));
        if (!tripdriveCustomerId) break;
        await admin
          .from('customers')
          .update({
            subscription_status: 'canceled',
            // No limpiamos stripe_subscription_id — preservamos para historia.
          })
          .eq('id', tripdriveCustomerId);
        break;
      }

      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = invoiceSubscriptionId(invoice);
        if (!subscriptionId) break;
        const tripdriveCustomerId = await resolveCustomerBySubscriptionId(admin, subscriptionId);
        if (!tripdriveCustomerId) break;
        // status concreto lo derivamos del re-fetch para no depender del
        // shape del invoice.
        const sub = await stripe.subscriptions.retrieve(subscriptionId);
        await admin
          .from('customers')
          .update({
            subscription_status: sub.status,
            subscription_current_period_end: subscriptionItemPeriodEnd(sub),
          })
          .eq('id', tripdriveCustomerId);
        break;
      }

      default:
        // No procesamos pero respondemos 200 para que Stripe deje de reintentar.
        logger.debug('stripe.webhook.ignored', { type: event.type, id: event.id });
        break;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Webhook processing failed';
    logger.error('stripe.webhook.processing_failed', {
      event_type: event.type,
      event_id: event.id,
      err: msg,
    });
    // Devolvemos 500 — Stripe reintenta. Idempotencia de nuestros UPDATEs
    // hace que un reintento sea seguro.
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────

async function resolveCustomerByStripeId(
  admin: ReturnType<typeof createServiceRoleClient>,
  stripeCustomerId: string | null,
): Promise<string | null> {
  if (!stripeCustomerId) return null;
  const { data } = await admin
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function resolveCustomerBySubscriptionId(
  admin: ReturnType<typeof createServiceRoleClient>,
  subscriptionId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('customers')
    .select('id')
    .eq('stripe_subscription_id', subscriptionId)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * El period end de la subscription. Stripe API 2024+ devuelve esto en
 * cada subscription_item, no en la subscription root. Tomamos el más
 * temprano de los items (el que vence primero define el ciclo).
 */
function subscriptionItemPeriodEnd(sub: Stripe.Subscription): string | null {
  if (sub.items.data.length === 0) return null;
  const earliest = sub.items.data.reduce<number | null>((min, item) => {
    const end = (item as unknown as { current_period_end?: number }).current_period_end;
    if (typeof end !== 'number') return min;
    return min === null || end < min ? end : min;
  }, null);
  if (earliest === null) return null;
  return new Date(earliest * 1000).toISOString();
}

/**
 * subscription_id de un invoice. El shape de Stripe lo expone como string
 * o como objeto expandido — manejamos ambos.
 */
function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const raw = (invoice as unknown as { subscription?: string | { id: string } }).subscription;
  if (!raw) return null;
  return typeof raw === 'string' ? raw : raw.id;
}
