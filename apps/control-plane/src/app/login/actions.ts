'use server';

// Server action de login del Control Plane.
//
// HARDENING C3 (2026-05-13): el CP tiene shared password único que da
// acceso a service_role cross-tenant. Para evitar online bruteforce
// agregamos:
//   1. Rate limit estricto por IP (5 intentos / 15 min).
//   2. Logging de cada intento fallido (Sentry/observability).
//   3. Minimo de password forzado a 16 chars (era 8).
//   4. Random jitter de 50-150ms en cada response — dificulta side
//      channels de timing al medir éxito vs fallo.

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { logger } from '@tripdrive/observability';
import { COOKIE_NAME, COOKIE_MAX_AGE_SECONDS, issueToken } from '@/lib/auth-token';
import { consumeByKey, CP_LIMITS, getClientIp } from '@/lib/rate-limit';

const MIN_PASSWORD_LEN = 16;

async function jitter(): Promise<void> {
  // Sleep aleatorio de 50-150ms para enmascarar diferencias de timing
  // entre código de éxito y código de error (comparación + DB call vs early return).
  const ms = 50 + Math.floor(Math.random() * 100);
  await new Promise((r) => setTimeout(r, ms));
}

export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/');

  const hdrs = await headers();
  const ip = getClientIp(hdrs);
  const ua = hdrs.get('user-agent') ?? 'unknown';

  // HARDENING C3 / paso 1: rate limit por IP. Bucket key incluye prefix
  // explícito para no colisionar con otros buckets que usen la misma RPC.
  const allowed = await consumeByKey(`cp-login:${ip}`, CP_LIMITS.cpLogin);
  if (!allowed) {
    await logger.warn('cp.login: rate limit excedido', { ip, ua });
    await jitter();
    return {
      error:
        'Demasiados intentos. Espera 15 minutos e intenta de nuevo. Si eres tú, ' +
        'verifica que tienes la contraseña correcta o pide ayuda en soporte.',
    };
  }

  const expected = process.env.CP_SHARED_PASSWORD;
  if (!expected || expected.length < MIN_PASSWORD_LEN) {
    await logger.error('cp.login: CP_SHARED_PASSWORD mal configurado en server', {
      configured: !!expected,
      length: expected?.length ?? 0,
      minRequired: MIN_PASSWORD_LEN,
    });
    await jitter();
    // Mensaje genérico al cliente — no leak del config.
    return { error: 'Servicio temporalmente no disponible. Contacta soporte.' };
  }

  // Comparación constante-en-tiempo manual (timingSafeEqual exige longitudes
  // iguales; aquí early-return en mismatch de longitud previene leak básico).
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  let diff = a.length !== b.length ? 1 : 0;
  // Iterar SIEMPRE hasta b.length para que el costo no varíe con la entrada.
  for (let i = 0; i < b.length; i++) {
    const aByte = i < a.length ? a[i]! : 0;
    diff |= aByte ^ b[i]!;
  }

  if (diff !== 0) {
    await logger.warn('cp.login: contraseña incorrecta', { ip, ua });
    await jitter();
    return { error: 'Contraseña incorrecta' };
  }

  let token: string;
  try {
    token = issueToken();
  } catch (err) {
    await logger.error('cp.login: error firmando cookie', {
      ip,
      err: err instanceof Error ? err.message : String(err),
    });
    await jitter();
    return { error: err instanceof Error ? err.message : 'Error firmando la cookie' };
  }

  await logger.info('cp.login: success', { ip, ua });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });

  // Sanitizar el `next` para evitar open-redirect (no permitir URLs externas).
  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  redirect(safeNext);
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect('/login');
}
