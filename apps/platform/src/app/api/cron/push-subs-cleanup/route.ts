// Cron: limpia push_subscriptions inactivas con created_at < now() - 90 days (issue #210).
//
// Razón: cada vez que un chofer reinstala la app o cambia de device, su
// expo_token nuevo se inserta pero el viejo queda como zombie hasta que un
// push intente alcanzarlo y reciba `DeviceNotRegistered` (lo cual sólo
// ocurre cuando hay actividad real). Sin cron, tokens zombies acumulan.
//
// Estrategia conservadora: borrar rows con created_at > 90 días. NO usa
// "last_active" porque no instrumentamos esa columna (issue futuro).
// Trade-off: tokens activos antiguos (chofer estable 6 meses) se borran y
// re-registran en el siguiente arranque de la app — re-registro es idempotente.
//
// Schedule sugerido: 1×/semana.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

const RETENTION_DAYS = 90;

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get('x-cron-token');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    await logger.error('cron.push-subs-cleanup: CRON_SECRET no configurado');
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
    .from('push_subscriptions')
    .delete()
    .lt('created_at', cutoff)
    .select('id, platform');

  if (error) {
    await logger.error('cron.push-subs-cleanup: DELETE falló', { err: error });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const counts = rows.reduce<Record<string, number>>((acc, r) => {
    const p = (r as { platform: string }).platform;
    acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});
  if (rows.length > 0) {
    logger.info('cron.push-subs-cleanup: ok', { deleted: rows.length, byPlatform: counts });
  }
  return NextResponse.json({ ok: true, deleted: rows.length, byPlatform: counts });
}
