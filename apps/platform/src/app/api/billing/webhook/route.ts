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

        if (!stripeCustomerId || !subscriptionId) {
          logger.error('stripe.webhook.checkout_no_session_data', { event_id: event.id });
          break;
        }

        // Caso A: customer existente (admin que ya tenía cuenta hace checkout
        // desde /settings/billing). El metadata trae `tripdrive_customer_id`.
        const existingCustomerId = session.metadata?.tripdrive_customer_id as string | undefined;

        // Caso B: signup público desde landing. El metadata trae los datos
        // del form para materializar customer + user.
        const signupCompany = session.metadata?.tripdrive_signup_company as string | undefined;
        const signupAdminEmail = session.metadata?.tripdrive_signup_admin_email as string | undefined;
        const signupAdminName = session.metadata?.tripdrive_signup_admin_name as string | undefined;
        const signupPlan = (session.metadata?.tripdrive_signup_plan as string | undefined) ?? 'pro';

        let tripdriveCustomerId: string | null = existingCustomerId ?? null;

        if (!tripdriveCustomerId && signupCompany && signupAdminEmail && signupAdminName) {
          // Provisión nueva — crea customer + user_profile + auth user.
          tripdriveCustomerId = await provisionNewCustomerFromSignup({
            adminClient: admin,
            stripe,
            companyName: signupCompany,
            adminName: signupAdminName,
            adminEmail: signupAdminEmail,
            plan: signupPlan,
            stripeCustomerId,
            stripeSubscriptionId: subscriptionId,
          });
        }

        if (!tripdriveCustomerId) {
          // Fallback: intentar resolver por stripe_customer_id si ya existía.
          tripdriveCustomerId = await resolveCustomerByStripeId(admin, stripeCustomerId);
        }

        if (!tripdriveCustomerId) {
          logger.error('stripe.webhook.checkout_unresolved_customer', {
            event_id: event.id,
            stripe_customer_id: stripeCustomerId,
            had_signup_metadata: Boolean(signupCompany),
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
            // Si era una provisión nueva, ya quedó como 'active'. Para
            // existentes, este update no toca status (omitido del payload).
          })
          .eq('id', tripdriveCustomerId);

        // Sync inicial de quantities.
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

/**
 * Self-serve signup desde la landing: materializa customer + user_profile +
 * auth user al confirmarse el pago. Idempotente: si el email ya existe como
 * user_profile (porque un webhook duplicado disparó), retorna el customer_id
 * existente sin duplicar.
 *
 * Pasos:
 *  1. slugify(companyName) único (sufijo numérico si colisión).
 *  2. Insert customer (status='active' porque ya pagó, tier=plan).
 *  3. Crear auth user via Supabase admin invite (manda magic link).
 *  4. Insert user_profile con role='admin', must_reset_password=true,
 *     customer_id=nuevo.
 *
 * Si cualquier paso falla, rollback best-effort. NO tiramos error al webhook
 * — devolvemos null y el log capturará el problema; idempotency de Stripe
 * eventualmente re-disparará.
 */
async function provisionNewCustomerFromSignup(opts: {
  adminClient: ReturnType<typeof createServiceRoleClient>;
  stripe: Stripe;
  companyName: string;
  adminName: string;
  adminEmail: string;
  plan: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
}): Promise<string | null> {
  const { adminClient, companyName, adminName, adminEmail, plan, stripeCustomerId, stripeSubscriptionId } = opts;

  // Idempotency: si el user_profile ya existe (webhook duplicado), retorna
  // el customer existente. Stripe puede re-disparar el mismo event.id.
  const { data: existingProfile } = await adminClient
    .from('user_profiles')
    .select('id, customer_id')
    .eq('email', adminEmail)
    .maybeSingle();
  if (existingProfile?.customer_id) {
    logger.info('stripe.webhook.signup_idempotent', {
      admin_email: adminEmail,
      customer_id: existingProfile.customer_id,
    });
    return existingProfile.customer_id as string;
  }

  // Si el stripe_customer_id ya tiene un customer asociado (caso edge:
  // re-firma con mismo Stripe customer), reutilizamos.
  const { data: existingCustomer } = await adminClient
    .from('customers')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .maybeSingle();
  if (existingCustomer?.id) {
    return existingCustomer.id as string;
  }

  // 1. Generar slug único.
  const baseSlug = slugifyForCustomer(companyName);
  const slug = await findAvailableSlug(adminClient, baseSlug);

  // 2. Insert customer. La landing UI dice "Operación / Pro / Enterprise",
  // pero el enum customer_tier en BD es 'starter' | 'pro' | 'enterprise'.
  // Mapeamos: operacion → starter; otros pasan tal cual.
  const tier: 'starter' | 'pro' | 'enterprise' =
    plan === 'operacion' ? 'starter' : plan === 'enterprise' ? 'enterprise' : 'pro';
  const { data: newCustomer, error: cErr } = await adminClient
    .from('customers')
    .insert({
      slug,
      name: companyName,
      tier,
      status: 'active',
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: stripeSubscriptionId,
    })
    .select('id')
    .single();
  if (cErr || !newCustomer) {
    logger.error('stripe.webhook.signup_customer_insert_failed', {
      admin_email: adminEmail,
      slug,
      err: cErr?.message,
    });
    return null;
  }
  const customerId = newCustomer.id as string;

  // 3. Crear auth user con magic link.
  const redirectTo = `${process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://app.tripdrive.xyz'}/login`;
  const { data: invited, error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(adminEmail, {
    data: { full_name: adminName, signup_via: 'landing' },
    redirectTo,
  });
  if (inviteErr || !invited.user) {
    logger.error('stripe.webhook.signup_invite_failed', {
      admin_email: adminEmail,
      customer_id: customerId,
      err: inviteErr?.message,
    });
    // Rollback customer — sin admin user, queda huérfano.
    await adminClient.from('customers').delete().eq('id', customerId);
    return null;
  }
  const userId = invited.user.id;

  // 4. Insert user_profile linked al nuevo customer con role admin.
  const { error: pErr } = await adminClient.from('user_profiles').insert({
    id: userId,
    customer_id: customerId,
    email: adminEmail,
    full_name: adminName,
    role: 'admin',
    zone_id: null,
    phone: null,
    must_reset_password: true,
    is_active: true,
  });
  if (pErr) {
    logger.error('stripe.webhook.signup_profile_insert_failed', {
      admin_email: adminEmail,
      customer_id: customerId,
      err: pErr.message,
    });
    // Rollback auth user + customer.
    await adminClient.auth.admin.deleteUser(userId).catch(() => {});
    await adminClient.from('customers').delete().eq('id', customerId);
    return null;
  }

  logger.info('stripe.webhook.signup_provisioned', {
    customer_id: customerId,
    admin_email: adminEmail,
    company: companyName,
    plan: tier,
  });

  return customerId;
}

/**
 * Convierte "Distribuidora Sol S.A. de C.V." → "distribuidora-sol".
 * Stripping caracteres no-ASCII + spaces → dashes + lowercase.
 * Max 40 chars (queda margen para sufijo numérico).
 */
function slugifyForCustomer(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Encuentra un slug disponible: si "distribuidora-sol" existe, intenta
 * "distribuidora-sol-2", "distribuidora-sol-3", etc.
 */
async function findAvailableSlug(
  admin: ReturnType<typeof createServiceRoleClient>,
  base: string,
): Promise<string> {
  let slug = base || `customer-${Date.now()}`;
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? slug : `${slug}-${suffix + 1}`;
    const { data } = await admin
      .from('customers')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (!data) return candidate;
  }
  // Fallback extremadamente improbable.
  return `${slug}-${Date.now()}`;
}
