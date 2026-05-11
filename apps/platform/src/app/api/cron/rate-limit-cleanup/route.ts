// Endpoint cron para limpiar rate_limit_buckets expirados — ADR-054 / issue #142.
//
// La tabla `rate_limit_buckets` crece con cada hit; sin cleanup periódico,
// los rows expirados (expires_at < now()) acumulan en BD. Este endpoint invoca
// la función SQL `tripdrive_rate_limit_cleanup()` que los borra en bloque.
//
// Llamar 1×/día desde n8n (4 AM local) con header `x-cron-token: $CRON_SECRET`.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get('x-cron-token');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.rate-limit-cleanup: CRON_SECRET no configurado');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en el server' },
      { status: 500 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('tripdrive_rate_limit_cleanup');
  if (error) {
    await logger.error('cron.rate-limit-cleanup: RPC falló', { err: error });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const deleted = (data as number | null) ?? 0;
  if (deleted > 0) {
    logger.info('cron.rate-limit-cleanup: ok', { deleted });
  }
  return NextResponse.json({ ok: true, deleted });
}
