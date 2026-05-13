// Cron: limpia chat_ai_decisions con classified_at < now() - 90 days (issue #53).
//
// Razón: chat_ai_decisions crece 1 row por cada mensaje del chofer
// clasificado por el AI mediator. A escala (multi-customer, 100+ choferes
// activos), la tabla puede llegar a millones de rows en un año. Usamos
// 90 días como retención — suficiente para auditar y calibrar el mediator,
// no tanto como para inflar BD.
//
// Schedule sugerido: 1×/día (puede ser 4:30 AM via Vercel Cron).
// Llamar con header `x-cron-token: $CRON_SECRET`.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

const RETENTION_DAYS = 90;

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get('x-cron-token');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.chat-decisions-cleanup: CRON_SECRET no configurado');
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en el server' },
      { status: 500 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('chat_ai_decisions')
    .delete()
    .lt('classified_at', cutoff)
    .select('id');

  if (error) {
    await logger.error('cron.chat-decisions-cleanup: DELETE falló', { err: error });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const deleted = (data ?? []).length;
  if (deleted > 0) {
    logger.info('cron.chat-decisions-cleanup: ok', { deleted, retentionDays: RETENTION_DAYS });
  }
  return NextResponse.json({ ok: true, deleted, retentionDays: RETENTION_DAYS });
}
