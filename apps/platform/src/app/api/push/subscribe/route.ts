// Endpoint que recibe la subscription Web Push del browser del admin/dispatcher
// y la persiste en `push_subscriptions` para que push-fanout.ts (driver app)
// pueda enviarles notifs cuando llegue un reporte de chofer.
//
// Patrón idéntico al endpoint del driver — duplicado intencional para no
// acoplar apps. Cuando crezca, mover a @verdfrut/notifications.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { UserRole } from '@verdfrut/types';

interface RequestBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return Response.json({ error: 'Sesión expirada' }, { status: 401 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ error: 'Body inválido' }, { status: 400 });
  }

  if (!body.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return Response.json(
      { error: 'Faltan campos: endpoint, keys.p256dh, keys.auth' },
      { status: 400 },
    );
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, zone_id')
    .eq('id', userData.user.id)
    .single();
  if (!profile) {
    return Response.json({ error: 'Perfil no encontrado' }, { status: 403 });
  }

  // Upsert por (user_id, endpoint) — UPDATE-or-INSERT manual.
  const { data: existing } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('user_id', userData.user.id)
    .eq('endpoint', body.endpoint)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('push_subscriptions')
      .update({ p256dh: body.keys.p256dh, auth: body.keys.auth })
      .eq('id', existing.id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from('push_subscriptions').insert({
      user_id: userData.user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      role: profile.role as UserRole,
      zone_id: profile.zone_id,
    });
    if (error) return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}

export async function DELETE(req: Request) {
  const supabase = await createServerClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return Response.json({ error: 'Sesión' }, { status: 401 });

  const { endpoint } = (await req.json()) as { endpoint?: string };
  if (!endpoint) return Response.json({ error: 'Falta endpoint' }, { status: 400 });

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userData.user.id)
    .eq('endpoint', endpoint);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
