// Cron diaria que detecta drift entre seats activos en BD y Stripe (ADR-111).
//
// Por qué existe:
//   `syncSeats` se llama en cada server action que toca user_profiles o drivers
//   (invite, toggle active, archive). Pero hay rutas donde puede salir mal:
//   - Stripe responde 5xx → audit queda con stripe_error, BD no se actualiza.
//   - DB cambia directo via SQL (migraciones, scripts manuales) sin pasar por
//     la server action — no se dispara syncSeats.
//   - El proceso muere a la mitad de un syncSeats (en background especialmente).
//
// Este endpoint recorre customers con subscription activa y vuelve a correr
// syncSeats con reason='periodic'. Si todo está al día, syncSeats short-circuits
// con skipReason='no_change' (cero llamadas a Stripe). Si hay drift, lo corrige
// con proration automática y registra en billing_seats_audit.
//
// Schedule: 04:00 hora local MX (10:00 UTC) — pico de actividad mínimo.
// Configurado en vercel.json `crons`.
//
// Auth dual:
//   - Vercel Cron envía `Authorization: Bearer <CRON_SECRET>` automáticamente
//     cuando el env var existe en el deployment.
//   - Triggers manuales (curl, otros schedulers) pueden usar `x-cron-token`.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import { syncSeats } from '@/lib/stripe/sync-seats';
import { getStripe } from '@/lib/stripe/client';

export const runtime = 'nodejs';
// Cron diaria, 1 ejecución a la vez. No queremos invocaciones concurrentes
// pisándose si el cron de Vercel hace overlapping bajo retry.
export const maxDuration = 300; // 5 min — para tenants con muchos customers

async function handler(req: Request): Promise<NextResponse> {
  // Auth dual: Authorization: Bearer (Vercel Cron) o x-cron-token (manual).
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.sync-stripe-seats: CRON_SECRET no configurado');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en el server' },
      { status: 500 },
    );
  }
  const auth = req.headers.get('authorization');
  const cronToken = req.headers.get('x-cron-token');
  const okBearer = auth === `Bearer ${expected}`;
  const okToken = cronToken === expected;
  if (!okBearer && !okToken) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  // Si Stripe no está configurado, salimos limpio (no es error). Útil en
  // previews / preview deploys sin keys de Stripe.
  if (!getStripe()) {
    logger.info('cron.sync-stripe-seats: stripe no configurado, skip');
    return NextResponse.json({ ok: true, skipped: true, reason: 'stripe_not_configured' });
  }

  const admin = createServiceRoleClient();

  // Solo customers que ya completaron checkout. Los que están en signup
  // (sin subscription_id) no tienen nada que sincronizar — el webhook de
  // checkout.session.completed los provisiona cuando paguen.
  const { data: customers, error } = await admin
    .from('customers')
    .select('id, name')
    .not('stripe_subscription_id', 'is', null);

  if (error) {
    await logger.error('cron.sync-stripe-seats: error listando customers', { err: error });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = {
    total: customers?.length ?? 0,
    drift_corrected: 0,
    no_change: 0,
    skipped: 0,
    errors: 0,
    errorDetails: [] as Array<{ customer_id: string; error: string }>,
  };

  // Procesamiento secuencial — Stripe rate limit es generoso pero no queremos
  // ráfagas paralelas. Para N customers, latencia esperada: N * ~300ms.
  // Con 50 customers eso son 15s, bien dentro del maxDuration.
  for (const c of customers ?? []) {
    const customerId = c.id as string;
    try {
      const res = await syncSeats({
        customerId,
        reason: 'periodic',
        triggeredBy: null,
      });
      if (!res.ok) {
        results.errors++;
        results.errorDetails.push({
          customer_id: customerId,
          error: res.error ?? 'unknown',
        });
      } else if (res.skipped) {
        results.skipped++;
      } else {
        // ok && !skipped → escribimos cambios a Stripe; hubo drift.
        results.drift_corrected++;
        if (res.skipReason === 'no_change') {
          results.no_change++;
        }
      }
    } catch (err) {
      results.errors++;
      results.errorDetails.push({
        customer_id: customerId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Log resumen solo si hubo cambios reales o errores — evita ruido en logs
  // los días en que no pasa nada (que serán la mayoría).
  if (results.drift_corrected > 0 || results.errors > 0) {
    logger.info('cron.sync-stripe-seats.ok', {
      total: results.total,
      drift_corrected: results.drift_corrected,
      errors: results.errors,
    });
  }

  return NextResponse.json({ ok: true, ...results });
}

// Vercel Cron envía GET por default. Aceptamos POST también para triggers
// manuales (curl, GitHub Actions) que prefieran ese verb.
export const GET = handler;
export const POST = handler;
