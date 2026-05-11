'use server';

// Server action que actualiza la contraseña del usuario autenticado y baja el flag
// must_reset_password. Después redirige al home según rol.

import { redirect } from 'next/navigation';
import { createServerClient } from '@tripdrive/supabase/server';
import { homeForDriverRole } from '@/lib/auth';
import type { UserRole } from '@tripdrive/types';

const MIN_LENGTH = 8;

export async function setPasswordAction(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < MIN_LENGTH) {
    return { error: `La contraseña debe tener al menos ${MIN_LENGTH} caracteres` };
  }
  if (password !== confirm) {
    return { error: 'Las contraseñas no coinciden' };
  }

  const supabase = await createServerClient();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return { error: 'Sesión expirada — pide un nuevo link' };
  }

  // 1. Actualizar password en auth.users.
  const { error: updateErr } = await supabase.auth.updateUser({ password });
  if (updateErr) {
    return { error: updateErr.message };
  }

  // 2. Bajar el flag must_reset_password en user_profiles.
  // Usamos el cliente con sesión del usuario (RLS aplicará), no service-role —
  // la policy `profiles_update` permite al usuario editar su propio row.
  const { error: profileErr } = await supabase
    .from('user_profiles')
    .update({ must_reset_password: false })
    .eq('id', userData.user.id);

  if (profileErr) {
    // Password ya cambió pero el flag quedó. No es fatal — el chofer puede usar la app
    // pero seguirá viendo el redirect a set-password. Logueamos para observabilidad.
    console.error('[set-password] No se pudo bajar must_reset_password:', profileErr);
    return { error: 'Contraseña actualizada pero falló confirmar el flag. Contacta al admin.' };
  }

  // 3. Resolver rol y redirigir al home apropiado.
  const { data: profile } = await supabase
    .from('user_profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  const role = (profile?.role ?? 'driver') as UserRole;
  redirect(homeForDriverRole(role));
}
