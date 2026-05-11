// Helpers de auth para la PWA del chofer.
// La driver app sólo permite roles 'driver' y 'zone_manager' (modo supervisor).

import 'server-only';
import { redirect } from 'next/navigation';
import { createServerClient } from '@tripdrive/supabase/server';
import type { UserProfile, UserRole } from '@tripdrive/types';

const ALLOWED_ROLES: UserRole[] = ['driver', 'zone_manager'];

/**
 * Devuelve el usuario auth o redirige a /login.
 */
export async function requireUser() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect('/login');
  return data.user;
}

/**
 * Devuelve el UserProfile completo y aplica todos los guards de la driver app:
 *   1. Rol debe ser driver o zone_manager (los admins no usan la driver app).
 *   2. Cuenta debe estar activa.
 *   3. Si must_reset_password=true, redirige a /auth/set-password
 *      (excepto cuando la URL actual ya ES set-password, para no loopear).
 */
export async function requireDriverProfile(opts?: { skipPasswordResetCheck?: boolean }): Promise<UserProfile> {
  const user = await requireUser();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, role, zone_id, phone, is_active, must_reset_password, created_at')
    .eq('id', user.id)
    .single();

  if (error || !data) {
    redirect('/login?error=' + encodeURIComponent('Perfil no configurado'));
  }

  if (!ALLOWED_ROLES.includes(data.role)) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('Esta cuenta no es de chofer'));
  }

  if (!data.is_active) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('Tu cuenta está desactivada'));
  }

  // Forzar reset de contraseña antes de seguir. La página de set-password
  // pasa skipPasswordResetCheck para no loopear consigo misma.
  if (data.must_reset_password && !opts?.skipPasswordResetCheck) {
    redirect('/auth/set-password');
  }

  return {
    id: data.id,
    email: data.email,
    fullName: data.full_name,
    role: data.role,
    zoneId: data.zone_id,
    phone: data.phone,
    isActive: data.is_active,
    mustResetPassword: data.must_reset_password,
    createdAt: data.created_at,
  };
}

/**
 * Home según rol — el driver va a su lista de paradas, el supervisor al mapa de su zona.
 */
export function homeForDriverRole(role: UserRole): string {
  switch (role) {
    case 'driver':
      return '/route';
    case 'zone_manager':
      return '/supervisor';
    default:
      // Otros roles no deberían llegar aquí (requireDriverProfile redirige).
      return '/login';
  }
}
