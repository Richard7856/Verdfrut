'use server';

// Server action de login del Control Plane — valida shared password y emite
// cookie firmada con HMAC.

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { COOKIE_NAME, COOKIE_MAX_AGE_SECONDS, issueToken } from '@/lib/auth-token';

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  const expected = process.env.CP_SHARED_PASSWORD;
  if (!expected || expected.length < 8) {
    return { error: 'CP_SHARED_PASSWORD no configurado en el server (mínimo 8 chars).' };
  }

  // Comparación constante-en-tiempo a mano (Buffer.from + timingSafeEqual no funciona
  // si las longitudes difieren; aquí simplemente prevenimos timing leakage trivial)
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return { error: 'Contraseña incorrecta' };
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  if (diff !== 0) return { error: 'Contraseña incorrecta' };

  let token: string;
  try {
    token = issueToken();
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Error firmando la cookie' };
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });

  // Sanitizar el `next` para evitar open-redirect (no permitir URLs externas)
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect('/login');
}
