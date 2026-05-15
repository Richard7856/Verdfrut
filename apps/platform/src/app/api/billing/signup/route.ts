// POST /api/billing/signup — endpoint público (sin auth) para self-serve
// signup desde la landing.
//
// Recibe { companyName, adminName, adminEmail, plan } → crea Stripe customer
// con metadata + Checkout Session subscription mode + devuelve URL. La
// creación del customer en BD y del auth user se hace en el webhook al
// confirmarse el pago — así evitamos orphan rows si el visitante abandona.
//
// Rate limit: defensa básica via IP. Si un attacker quiere spammear Stripe
// customers, el rate limit lo frena. (Stripe customers son "free" pero
// inflan el dashboard.)

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { logger } from '@tripdrive/observability';
import {
  requireStripe,
  requirePriceIdsForTier,
  getReturnUrls,
  planNameToTier,
} from '@/lib/stripe/client';
import { createServiceRoleClient } from '@tripdrive/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SignupPayload {
  companyName?: unknown;
  adminName?: unknown;
  adminEmail?: unknown;
  plan?: unknown;
}

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let stripe;
  let urls;
  try {
    stripe = requireStripe();
    urls = getReturnUrls();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Stripe no configurado' },
      { status: 503 },
    );
  }

  // Rate limit suave: 1 signup por IP cada 30 segundos. Usa la tabla
  // rate_limit_buckets que ya existe (ADR-051 + H4). Si la tabla falla por
  // cualquier motivo, dejamos pasar — no es bloqueador del onboarding.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown';
  // Rate limit: 5 intentos por minuto por IP. Antes era 1/30s (muy agresivo
  // para debug + para usuarios que dudan y reintentan rápido). El abuso real
  // sigue protegido porque 5/min × 60min = 300 customers ficticios/hora
  // máximo por IP, más que suficiente para frenar un script malicioso.
  try {
    const supabase = createServiceRoleClient();
    const { data: rateOk } = await supabase.rpc('tripdrive_rate_limit_check', {
      p_bucket_key: `signup:${ip}`,
      p_window_seconds: 60,
      p_max_hits: 5,
    });
    if (rateOk === false) {
      return NextResponse.json(
        { error: 'Demasiados intentos. Espera un minuto antes de volver a intentar.' },
        { status: 429 },
      );
    }
  } catch {
    // RPC opcional — sigue.
  }

  // Validación del body.
  let body: SignupPayload;
  try {
    body = (await req.json()) as SignupPayload;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
  const adminName = typeof body.adminName === 'string' ? body.adminName.trim() : '';
  const adminEmail =
    typeof body.adminEmail === 'string' ? body.adminEmail.trim().toLowerCase() : '';
  const planRaw = typeof body.plan === 'string' ? body.plan : 'pro';
  const plan = planRaw === 'pro' || planRaw === 'operacion' || planRaw === 'enterprise'
    ? planRaw
    : 'pro';
  // Map al enum customer_tier de BD + resolver price IDs del tier elegido.
  const tier = planNameToTier(plan);
  let priceIds;
  try {
    priceIds = requirePriceIdsForTier(tier);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Tier sin configurar' },
      { status: 503 },
    );
  }

  if (companyName.length < 2 || companyName.length > 80) {
    return NextResponse.json({ error: 'Nombre de empresa inválido (2-80 chars).' }, { status: 400 });
  }
  if (adminName.length < 2 || adminName.length > 80) {
    return NextResponse.json({ error: 'Nombre de administrador inválido.' }, { status: 400 });
  }
  if (!EMAIL_RX.test(adminEmail) || adminEmail.length > 120) {
    return NextResponse.json({ error: 'Email inválido.' }, { status: 400 });
  }

  // Defensa: si el email ya tiene un user_profile activo en cualquier
  // customer, NO crear duplicado. Le decimos al user que entre al login.
  const admin = createServiceRoleClient();
  const { data: existing } = await admin
    .from('user_profiles')
    .select('id, customer_id')
    .eq('email', adminEmail)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      {
        error:
          'Ya existe una cuenta con ese email. Entra en https://app.tripdrive.xyz/login (o pide a tu admin que te re-invite).',
      },
      { status: 409 },
    );
  }

  // Crear Stripe customer. La empresa va como `name` para que aparezca
  // limpio en sus facturas; el email es del admin que firma.
  let stripeCustomerId: string;
  try {
    const created = await stripe.customers.create({
      name: companyName,
      email: adminEmail,
      metadata: {
        // Estos metadata los lee el webhook para materializar customer + user.
        tripdrive_signup_company: companyName,
        tripdrive_signup_admin_name: adminName,
        tripdrive_signup_admin_email: adminEmail,
        tripdrive_signup_plan: plan,
        tripdrive_signup_source: 'landing_public',
      },
    });
    stripeCustomerId = created.id;
  } catch (err) {
    // El mensaje raw de Stripe puede contener fragmentos de la API key
    // (ej. "Invalid API Key provided: sk_live_***...m61"). Lo loggeamos
    // server-side pero NO lo retornamos al cliente — el usuario ve un
    // mensaje genérico para evitar leaks por UI accidental.
    const rawMsg = err instanceof Error ? err.message : String(err);
    logger.error('stripe.signup.create_customer_failed', { email: adminEmail, err: rawMsg });
    return NextResponse.json(
      {
        error:
          'No pudimos iniciar el pago. Inténtalo de nuevo en unos minutos o contáctanos a soporte@tripdrive.xyz.',
      },
      { status: 502 },
    );
  }

  // Crear Checkout Session. Signup nuevo arranca con la licencia base sola
  // (sin extras) — el cliente paga el piso y va invitando admins/choferes
  // según necesite. Apenas cruce el mínimo (2 admins + 5 choferes), el
  // syncSeats post-invite ajusta extras automáticamente con proration.
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [
        { price: priceIds.base, quantity: 1 },
        { price: priceIds.extraAdmin, quantity: 0 },
        { price: priceIds.extraDriver, quantity: 0 },
      ],
      success_url: `${urls.success.replace('/settings/billing?success=1', '/empezar?success=1')}`,
      cancel_url: `${urls.cancel.replace('/settings/billing?canceled=1', '/empezar?canceled=1')}`,
      subscription_data: {
        metadata: {
          // Estos metadata también los lee el webhook (subscription events).
          tripdrive_signup_company: companyName,
          tripdrive_signup_admin_name: adminName,
          tripdrive_signup_admin_email: adminEmail,
          tripdrive_signup_plan: plan,
        },
      },
      allow_promotion_codes: true,
    });

    logger.info('stripe.signup.session_created', {
      stripe_customer_id: stripeCustomerId,
      email: adminEmail,
      company: companyName,
      plan,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const rawMsg = err instanceof Error ? err.message : String(err);
    logger.error('stripe.signup.create_session_failed', { email: adminEmail, err: rawMsg });
    return NextResponse.json(
      {
        error:
          'No pudimos iniciar el pago. Inténtalo de nuevo en unos minutos o contáctanos a soporte@tripdrive.xyz.',
      },
      { status: 502 },
    );
  }
}
