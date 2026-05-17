// ADR-126 / Fase 2: cron mensual que resetea contadores de cuota AI.
//
// Schedule (vercel.json): `5 0 1 * *` → 00:05 UTC del día 1 de cada mes.
// Hora elegida fuera del pico operativo del cron de seats (10:00 UTC).
//
// Implementación: invoca el RPC `reset_ai_quotas_for_period` que pone
// ai_*_used_month=0 y avanza ai_quota_period_starts_at al primero del mes
// en curso. Idempotente — correr 2 veces el mismo día no causa daño.
//
// Auth dual: Bearer del CRON_SECRET (Vercel Cron lo envía automático) o
// header x-cron-token (manual via curl). Mismo patrón que sync-stripe-seats.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export const runtime = 'nodejs';
export const maxDuration = 60; // 1 update masivo es < 5s incluso con muchos customers.

async function handler(req: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.reset-ai-quotas: CRON_SECRET no configurado');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en deployment' },
      { status: 500 },
    );
  }

  // Authorization: Bearer <token> (Vercel) o x-cron-token (manual).
  const authHeader = req.headers.get('authorization') ?? '';
  const fromAuth = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const fromCustom = req.headers.get('x-cron-token') ?? '';
  if (fromAuth !== expected && fromCustom !== expected) {
    return NextResponse.json({ ok: false, error: 'no autorizado' }, { status: 401 });
  }

  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc('reset_ai_quotas_for_period');
    if (error) {
      await logger.error('cron.reset-ai-quotas: RPC falló', { err: error });
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    const resetCount = (data as number | null) ?? 0;
    await logger.info('cron.reset-ai-quotas: completado', { resetCount });
    return NextResponse.json({ ok: true, resetCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'error desconocido';
    await logger.error('cron.reset-ai-quotas: excepción', { err: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

// Vercel Cron usa GET por default; permitimos POST también para triggers
// manuales con curl (que mucha gente usa con POST por costumbre).
export const GET = handler;
export const POST = handler;
