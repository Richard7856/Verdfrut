// Helpers de autenticación server-side. Todos llaman al cliente Supabase del request.

import 'server-only';
import { redirect } from 'next/navigation';
import { createServerClient } from '@tripdrive/supabase/server';
import type { UserProfile, UserRole } from '@tripdrive/types';

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
 * redirige a la home apropiada de su rol (NO a `/`, porque para zone_manager
 * eso causaría loop si pretende abrir una vista de admin).
 */
export async function requireRole(...allowed: UserRole[]): Promise<UserProfile> {
  const profile = await requireProfile();
  if (!allowed.includes(profile.role)) redirect(homeForRole(profile.role));
  return profile;
}

/**
 * Atajo: solo admin/dispatcher (excluye zone_manager y driver).
 * Usar en páginas de supervisión global: /map, /dashboard, /incidents (lista),
 * /routes, /dispatches, /settings, etc. — todo lo que NO sea el chat directo.
 *
 * Modelo de roles V3 (ADR-124, 2026-05-16):
 * - admin / dispatcher: operadores. Ven todo, operan todo. Son seats facturables.
 * - zone_manager: supervisor read-only + chat + incidencias. NO es seat.
 *   - zone_id = null → customer-wide (ve todas las zonas del customer).
 *     Caso de uso: encargado de un cliente que supervisa CDMX + Toluca.
 *   - zone_id = X → zone-scoped (ve solo su zona). Caso de uso: jefe de
 *     región / coordinador local.
 * - driver: solo driver app.
 */
export async function requireAdminOrDispatcher(): Promise<UserProfile> {
  return requireRole('admin', 'dispatcher');
}

/**
 * True para roles que pueden ejecutar writes (crear, modificar, publicar,
 * cancelar, optimizar, mover paradas, etc.). zone_manager NO opera —
 * solo ve y usa chat de incidencias.
 *
 * Server actions de write hacen `requireRole('admin', 'dispatcher')` por
 * su lado (defense-in-depth). Esta helper sirve para esconder los botones
 * en UI de forma centralizada — usar como `if (!isOperator(profile)) return null;`
 * o `<Show when={isOperator(profile)}>...</Show>`.
 */
export function isOperator(profile: Pick<UserProfile, 'role'>): boolean {
  return profile.role === 'admin' || profile.role === 'dispatcher';
}

/**
 * True si el profile puede ver datos de TODO el customer (todas las zonas)
 * vs estar restringido a una zona específica. admin y dispatcher siempre
 * customer-wide. zone_manager customer-wide solo si zoneId === null.
 *
 * Use case: páginas que renderean "ver todas las zonas" vs filter forced
 * a la zona del user. El filtro de zona en /dia, /dashboard, etc. se
 * muestra solo si esta helper devuelve true.
 */
export function canViewAllZones(
  profile: Pick<UserProfile, 'role' | 'zoneId'>,
): boolean {
  if (profile.role === 'admin' || profile.role === 'dispatcher') return true;
  if (profile.role === 'zone_manager' && !profile.zoneId) return true;
  return false;
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
      // ADR-124 (V3 de roles): zone_manager se vuelve supervisor read-only.
      // Su home natural es /dia/[hoy] — el mapa con todas las rutas del día.
      // /incidents/active-chat sigue accesible por sidebar para gestionar
      // problemas reportados por choferes.
      return `/dia/${new Date().toISOString().slice(0, 10)}`;
    case 'driver':
      // El driver no debería entrar al platform — su home es la driver app.
      return '/login';
  }
}
