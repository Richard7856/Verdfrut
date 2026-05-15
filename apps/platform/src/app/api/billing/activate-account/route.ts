// POST /api/billing/activate-account — establece la contraseña del admin
// recién creado tras un checkout exitoso. Público (sin auth — el user
// todavía no tiene cuenta activa).
//
// Defensa contra abuso:
//  1. Re-verifica el session_id con Stripe (debe estar 'paid'). Sin esto, un
//     attacker podría pegarle al endpoint con cualquier email + password y
//     setear contraseñas a usuarios existentes.
//  2. El email del payload se ignora — usamos el del metadata de la sesión
//     de Stripe. El attacker no puede pasar email arbitrario.
//  3. Solo permite activar si el user_profile tiene must_reset_password=true.
//     Si ya está activo (segunda visita), respondemos 200 idempotente para
//     que el flow del cliente no se rompa al refresh.

import 'server-only';
import { NextResponse, type NextRequest } from 'next/server';
import { requireStripe } from '@/lib/stripe/client';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Payload {
  session_id?: unknown;
  password?: unknown;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let stripe;
  try {
    stripe = requireStripe();
  } catch {
    return NextResponse.json({ error: 'Stripe no configurado.' }, { status: 503 });
  }

  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!sessionId.startsWith('cs_')) {
    return NextResponse.json({ error: 'session_id inválido' }, { status: 400 });
  }
  if (password.length < 10 || password.length > 200) {
    return NextResponse.json({ error: 'La contraseña debe tener 10-200 caracteres.' }, { status: 400 });
  }

  // 1. Re-verificar con Stripe que la sesión existe y está pagada.
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    logger.warn('activate.session_invalid', { session_id: sessionId, err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: 'Sesión de pago no válida.' }, { status: 400 });
  }
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return NextResponse.json({ error: 'El pago todavía no está confirmado.' }, { status: 400 });
  }

  // 2. El email viene de los metadata firmados por Stripe — no del payload.
  const adminEmail = session.metadata?.tripdrive_signup_admin_email as string | undefined;
  if (!adminEmail) {
    logger.error('activate.email_missing', { session_id: sessionId });
    return NextResponse.json({ error: 'Faltan datos del registro.' }, { status: 400 });
  }

  // 3. Buscar el user_profile + auth user.
  const admin = createServiceRoleClient();
  const { data: profile } = await admin
    .from('user_profiles')
    .select('id, must_reset_password')
    .eq('email', adminEmail)
    .maybeSingle();
  if (!profile) {
    return NextResponse.json(
      { error: 'Cuenta no encontrada todavía. Recarga la página en unos segundos.' },
      { status: 404 },
    );
  }

  // Idempotente: si ya activó la cuenta antes (must_reset_password=false),
  // simplemente devolvemos OK sin tocar la password.
  if (profile.must_reset_password === false) {
    return NextResponse.json({ ok: true, alreadyActivated: true });
  }

  // 4. Update password en Supabase Auth + clear flag.
  const { error: updateErr } = await admin.auth.admin.updateUserById(profile.id, {
    password,
  });
  if (updateErr) {
    logger.error('activate.password_update_failed', {
      user_id: profile.id,
      err: updateErr.message,
    });
    return NextResponse.json(
      { error: 'No pudimos guardar tu contraseña. Inténtalo de nuevo.' },
      { status: 500 },
    );
  }

  const { error: profileErr } = await admin
    .from('user_profiles')
    .update({ must_reset_password: false })
    .eq('id', profile.id);
  if (profileErr) {
    // No fatal — el password ya quedó. Solo loguea.
    logger.warn('activate.flag_clear_failed', { user_id: profile.id, err: profileErr.message });
  }

  logger.info('activate.account_activated', {
    user_id: profile.id,
    email: adminEmail,
  });

  return NextResponse.json({ ok: true });
}
