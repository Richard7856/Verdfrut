'use server';

// Server Actions de login/logout para la driver app.
// Sólo permite roles 'driver' y 'zone_manager' (no admin/dispatcher — esos van al platform).

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { logger } from '@tripdrive/observability';
import { createServerClient } from '@tripdrive/supabase/server';
import { homeForDriverRole } from '@/lib/auth';
import type { UserRole } from '@tripdrive/types';

const ALLOWED_ROLES: UserRole[] = ['driver', 'zone_manager'];

// Mensajes genéricos para no filtrar info que ayude a brute-force.
// Pero SIEMPRE devolvemos un error útil — nunca dejamos que el form se
// re-renderice sin razón visible al user. Logueamos detalle server-side.
const ERR_INVALID_CREDS = 'Usuario o contraseña incorrectos. Verifica tus datos e intenta de nuevo.';
const ERR_GENERIC = 'No pudimos iniciar tu sesión. Intenta de nuevo o contacta a soporte.';

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  // Wrap todo en try/catch para que NUNCA throw exception y dejemos al form
  // sin error visible. Cualquier excepción inesperada cae al ERR_GENERIC.
  try {
    const email = String(formData.get('email') ?? '').trim();
    const password = String(formData.get('password') ?? '');
    const next = String(formData.get('next') ?? '');

    if (!email || !password) {
      return { error: 'Email y contraseña son obligatorios.' };
    }

    const supabase = await createServerClient();
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) {
      // Loguear server-side para debug, pero mostrar mensaje genérico al user.
      logger.info('driver.login.sign_in_failed', {
        email_domain: email.split('@')[1] ?? 'unknown',
        supabase_code: signInErr.code ?? 'unknown',
        supabase_status: signInErr.status ?? 0,
      });
      return { error: ERR_INVALID_CREDS };
    }

    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) {
      logger.warn('driver.login.no_user_after_signin', { email_domain: email.split('@')[1] });
      return { error: ERR_GENERIC };
    }

    const { data: profile, error: profileErr } = await supabase
      .from('user_profiles')
      .select('role, is_active')
      .eq('id', userData.user.id)
      .single();

    if (profileErr || !profile) {
      logger.error('driver.login.profile_missing', {
        user_id: userData.user.id,
        error: profileErr?.message,
      });
      await supabase.auth.signOut();
      return { error: 'Tu cuenta no tiene perfil configurado. Contacta a soporte.' };
    }

    if (!profile.is_active) {
      logger.info('driver.login.inactive_account', { user_id: userData.user.id });
      await supabase.auth.signOut();
      return { error: 'Tu cuenta está desactivada. Contacta a soporte.' };
    }

    if (!ALLOWED_ROLES.includes(profile.role)) {
      logger.info('driver.login.wrong_role', { user_id: userData.user.id, role: profile.role });
      await supabase.auth.signOut();
      return {
        error: `Esta cuenta es de tipo "${profile.role}", no de chofer. Usa el panel web (app.tripdrive.xyz).`,
      };
    }

    // Éxito — redirect. NOTA: `redirect()` lanza una excepción NEXT_REDIRECT
    // que Next.js intercepta. NO la capturamos con el try/catch externo
    // (la dejamos propagar) porque eso ES el éxito.
    redirect(next || homeForDriverRole(profile.role));
  } catch (err) {
    // `redirect()` de next/navigation lanza una excepción especial que NO debemos
    // capturar — Next la usa para implementar el redirect. La re-lanzamos.
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    // Esto cubre el caso de Next 14+ donde el mensaje empieza con NEXT_REDIRECT.
    if (err instanceof Error && err.message.startsWith('NEXT_REDIRECT')) throw err;

    // Cualquier otra excepción (BD caída, Supabase no responde, etc.) cae aquí.
    // Logueamos detalle y devolvemos mensaje genérico al user.
    logger.error('driver.login.unexpected_error', {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    return { error: ERR_GENERIC };
  }
}

export async function logoutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
