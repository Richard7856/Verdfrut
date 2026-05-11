'use server';

// Server Actions de login/logout para la driver app.
// Sólo permite roles 'driver' y 'zone_manager' (no admin/dispatcher — esos van al platform).

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@tripdrive/supabase/server';
import { homeForDriverRole } from '@/lib/auth';
import type { UserRole } from '@tripdrive/types';

const ALLOWED_ROLES: UserRole[] = ['driver', 'zone_manager'];

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '');

  if (!email || !password) {
    return { error: 'Email y contraseña son obligatorios' };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: 'Credenciales inválidas' };
  }

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'No se pudo obtener el usuario' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role, is_active')
    .eq('id', userData.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return { error: 'Tu cuenta no tiene perfil configurado. Contacta al admin.' };
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return { error: 'Tu cuenta está desactivada' };
  }

  if (!ALLOWED_ROLES.includes(profile.role)) {
    // Admin/dispatcher entran al platform, no aquí.
    await supabase.auth.signOut();
    return { error: 'Esta cuenta no es de chofer. Usa el panel web.' };
  }

  redirect(next || homeForDriverRole(profile.role));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
