// Endpoint cron para archivar breadcrumbs viejos — S18.6 / issue #33.
// Llamar 1× por mes desde n8n / GitHub Actions.
//
// Auth: header `x-cron-token` debe matchear `CRON_SECRET` (env, mismo que los
// otros 2 crons del platform).
//
// Implementación: invoca la función SQL archive_old_breadcrumbs(retention_days).
// Default 90 días — ajustable por query string ?days=N.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@verdfrut/supabase/server';
import { logger } from '@verdfrut/observability';

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get('x-cron-token');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.archive-breadcrumbs: CRON_SECRET no configurado en server');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en el server' },
      { status: 500 },
    );
  }
  if (token !== expected) {
    // No log a Sentry: cualquier scanner del internet puede pegar a este endpoint.
    // Solo runtime log para detectar patrones de abuso si fuera el caso.
    logger.info('cron.archive-breadcrumbs: token inválido');
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = url.searchParams.get('days');
  const retentionDays = daysParam ? Math.max(parseInt(daysParam, 10) || 90, 1) : 90;

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('archive_old_breadcrumbs', {
    retention_days: retentionDays,
  });
  if (error) {
    await logger.error('cron.archive-breadcrumbs: RPC falló', {
      retentionDays, err: error,
    });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  logger.info('cron.archive-breadcrumbs: ok', { deleted: data ?? 0, retentionDays });
  return NextResponse.json({ ok: true, deleted: data ?? 0, retentionDays });
}
