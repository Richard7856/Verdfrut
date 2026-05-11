// Route Handler que recibe los enlaces de invite/recovery de Supabase Auth.
//
// Acepta dos formatos de query:
//   1. `?code=...` (PKCE flow desde SDK cliente) → exchangeCodeForSession.
//   2. `?token_hash=...&type=invite|recovery|...` (server-side verify, lo que
//      construye el platform en buildServerCallbackLink) → verifyOtp.
//
// Importante: el endpoint default de Supabase `/auth/v1/verify` redirige con los
// tokens en el HASH (#access_token=...) — eso no llega al server. Por eso el
// platform NO usa el `action_link` que devuelve `auth.admin.generateLink`, sino
// que extrae `hashed_token` + `verification_type` y construye su propio link
// directo a este Route Handler.
//
// Después de verificar el token, leemos must_reset_password del profile:
//   - invite  → siempre redirige a /auth/set-password
//   - flag=true → idem
//   - else → home según rol

import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@tripdrive/supabase/server';
import { homeForDriverRole } from '@/lib/auth';
import type { UserRole } from '@tripdrive/types';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as
    | 'invite'
    | 'recovery'
    | 'magiclink'
    | 'signup'
    | 'email_change'
    | null;
  const next = url.searchParams.get('next') ?? null;

  const supabase = await createServerClient();

  let exchangeError: string | null = null;

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) exchangeError = error.message;
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) exchangeError = error.message;
  } else {
    exchangeError = 'Link inválido o expirado (sin code/token)';
  }

  if (exchangeError) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', exchangeError);
    return NextResponse.redirect(loginUrl);
  }

  // Sesión activa. Leer profile para decidir destino.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', 'No se pudo crear sesión');
    return NextResponse.redirect(loginUrl);
  }

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active, must_reset_password')
    .eq('id', user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', 'Perfil no encontrado');
    return NextResponse.redirect(loginUrl);
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('error', 'Tu cuenta está desactivada');
    return NextResponse.redirect(loginUrl);
  }

  // Invite siempre fuerza set-password. Recovery también si así viene del platform.
  // En cualquier caso, must_reset_password=true → set-password.
  if (type === 'invite' || profile.must_reset_password) {
    return NextResponse.redirect(new URL('/auth/set-password', req.url));
  }

  // Login normal — al destino solicitado o home según rol.
  const dest = next ?? homeForDriverRole(profile.role as UserRole);
  return NextResponse.redirect(new URL(dest, req.url));
}
