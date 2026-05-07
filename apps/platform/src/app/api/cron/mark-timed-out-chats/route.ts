// Endpoint del cron para marcar chats con timeout (#40 / ADR-023).
// Llamar cada 1 minuto desde n8n / GitHub Actions / cron externo.
//
// Auth: header `x-cron-token` debe matchear `CRON_SECRET` (env). Sin token
// válido → 401. No usa cookies — es server-to-server.
//
// Implementación: invoca la función SQL `mark_timed_out_chats()` con el
// service role client (RLS bypass).

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@verdfrut/supabase/server';

export async function POST(req: Request): Promise<NextResponse> {
  const token = req.headers.get('x-cron-token');
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET no configurado en el server' },
      { status: 500 },
    );
  }
  if (token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc('mark_timed_out_chats');
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, affected: data ?? 0 });
}
