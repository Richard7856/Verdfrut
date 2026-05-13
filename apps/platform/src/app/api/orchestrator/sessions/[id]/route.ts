// Carga una sesión específica (mensajes + metadata) para resumir conversación.

import 'server-only';
import { requireAdminOrDispatcher } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, { params }: RouteContext) {
  const profile = await requireAdminOrDispatcher();
  const { id } = await params;

  const supabase = await createServerClient();

  // RLS valida ownership — el user solo ve sus propias sessions (o admin
  // del customer ve todas).
  const { data: session, error: sessErr } = await supabase
    .from('orchestrator_sessions')
    .select('id, title, state, total_tokens_in, total_tokens_out, total_actions, created_at, updated_at, user_id')
    .eq('id', id)
    .maybeSingle();

  if (sessErr) return Response.json({ error: sessErr.message }, { status: 500 });
  if (!session) return Response.json({ error: 'no encontrada' }, { status: 404 });
  if (session.user_id !== profile.id) {
    return Response.json({ error: 'no eres dueño' }, { status: 403 });
  }

  const { data: messages } = await supabase
    .from('orchestrator_messages')
    .select('id, sequence, role, content, tokens_in, tokens_out, created_at')
    .eq('session_id', id)
    .order('sequence', { ascending: true });

  return Response.json({ session, messages: messages ?? [] });
}
