// Endpoint cron para limpiar auth.users huérfanos — issue #16.
// Llamar 1× por día desde n8n / GitHub Actions.
//
// Auth: header `x-cron-token` debe matchear `CRON_SECRET` (mismo que el cron de chats).
//
// Flujo:
//   1. Llama get_orphan_auth_users() SQL para obtener IDs sin user_profile.
//   2. Elimina cada uno vía admin.auth.admin.deleteUser() (limpia auth.sessions,
//      auth.identities, etc. — NO es DELETE directo a auth.users).
//   3. Devuelve { deleted, orphans } para auditoría en los logs del cron.

import { NextResponse } from 'next/server';
import { createServiceRoleClient } from '@verdfrut/supabase/server';

interface OrphanRow {
  user_id: string;
  email: string | null;
  created_at: string;
}

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

  const { data: orphans, error: queryErr } = await supabase.rpc('get_orphan_auth_users');
  if (queryErr) {
    return NextResponse.json({ ok: false, error: queryErr.message }, { status: 500 });
  }

  const rows = (orphans ?? []) as unknown as OrphanRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, deleted: 0, orphans: [] });
  }

  const deleted: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const row of rows) {
    const { error: delErr } = await supabase.auth.admin.deleteUser(row.user_id);
    if (delErr) {
      failed.push({ id: row.user_id, error: delErr.message });
    } else {
      deleted.push(row.user_id);
    }
  }

  if (failed.length > 0) {
    console.error('[cron/reconcile-orphan-users] Fallos al eliminar:', failed);
  }

  return NextResponse.json({
    ok: true,
    deleted: deleted.length,
    failed: failed.length > 0 ? failed : undefined,
    // IDs y emails para auditoría — no PII fuera de los logs internos
    orphans: rows.map((r) => ({ id: r.user_id, email: r.email, createdAt: r.created_at })),
  });
}
