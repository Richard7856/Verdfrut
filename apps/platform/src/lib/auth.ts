// Helpers de autenticación server-side. Todos llaman al cliente Supabase del request.

import 'server-only';
import { redirect } from 'next/navigation';
import { createServerClient } from '@verdfrut/supabase/server';
import type { UserProfile, UserRole } from '@verdfrut/types';

/**
 * Devuelve el usuario autenticado o redirige a /login.
 * Usar en Server Components / Server Actions / Route Handlers protegidos.
 */
export async function requireUser() {
  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect('/login');
  return data.user;
}

/**
 * Devuelve el UserProfile (con rol y zona) o redirige.
 * El profile vive en la tabla user_profiles del proyecto del tenant.
 */
export async function requireProfile(): Promise<UserProfile> {
  const user = await requireUser();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, email, full_name, role, zone_id, phone, is_active, must_reset_password, created_at')
    .eq('id', user.id)
    .single();

  if (error || !data) redirect('/login');

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
 * Restringe acceso a roles específicos. Si el usuario no tiene un rol permitido,
 * redirige a la home (que ya lo lleva al dashboard apropiado).
 */
export async function requireRole(...allowed: UserRole[]): Promise<UserProfile> {
  const profile = await requireProfile();
  if (!allowed.includes(profile.role)) redirect('/');
  return profile;
}

/**
 * Devuelve la home apropiada para el rol del usuario.
 * Usar después de login para redirigir al dashboard correcto.
 */
export function homeForRole(role: UserRole): string {
  switch (role) {
    case 'admin':
    case 'dispatcher':
      return '/routes';
    case 'zone_manager':
      return '/dashboard';
    case 'driver':
      // El driver no debería entrar al platform — su home es la driver app.
      return '/login';
  }
}
