// Lista de sesiones del orquestador del user actual (panel lateral de /orchestrator).

import 'server-only';
import { requireAdminOrDispatcher } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const profile = await requireAdminOrDispatcher();
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('orchestrator_sessions')
    .select('id, title, state, last_message_at, total_tokens_in, total_tokens_out, total_actions, created_at, updated_at')
    .eq('user_id', profile.id)
    .order('updated_at', { ascending: false })
    .limit(30);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ sessions: data ?? [] });
}
