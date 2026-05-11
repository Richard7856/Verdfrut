'use server';

// Server Actions para login/logout. Auth via Supabase email+password.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@tripdrive/supabase/server';
import { homeForRole } from '@/lib/auth';

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
    // Devolver mensaje genérico para no filtrar si el email existe.
    return { error: 'Credenciales inválidas' };
  }

  // Resolver el rol del usuario y redirigir a su home.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: 'No se pudo obtener el usuario' };

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (!profile) {
    await supabase.auth.signOut();
    return { error: 'Tu cuenta no tiene perfil configurado. Contacta al admin.' };
  }

  // Si role es 'driver' este usuario no debería entrar al platform.
  if (profile.role === 'driver') {
    await supabase.auth.signOut();
    return { error: 'Esta cuenta es de chofer. Usa la app móvil.' };
  }

  redirect(next || homeForRole(profile.role));
}

export async function logoutAction(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}
