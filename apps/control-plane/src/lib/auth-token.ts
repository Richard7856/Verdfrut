// Token de sesión para el Control Plane — Sprint 17.
//
// V1 sin Supabase Auth: el staff de TripDrive entra con una shared password
// (env CP_SHARED_PASSWORD). Tras validar, emitimos una cookie firmada con HMAC
// que prueba "este browser conoce la password". No hay revocación granular —
// rotar `CP_COOKIE_SECRET` invalida todas las sesiones existentes.
//
// Por qué no Supabase Auth: requiere proyecto separado del CP funcionando con
// usuarios reales. V1 tiene 1-2 personas con acceso, shared password basta.
// Migración a auth completo está en el roadmap (Sprint 18+).

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOKEN_VERSION = 'v1';
// 7 días — el staff renueva al iniciar la semana
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const secret = process.env.CP_COOKIE_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      '[control-plane.auth] CP_COOKIE_SECRET no configurado o demasiado corto (mínimo 16 chars)',
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

/** Genera un token firmado con timestamp actual. */
export function issueToken(): string {
  const issuedAt = Date.now();
  const payload = `${TOKEN_VERSION}.${issuedAt}`;
  const sig = sign(payload);
  return `${payload}.${sig}`;
}

/** Verifica un token. Devuelve true si válido y no expirado. */
export function verifyToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [version, issuedAtStr, sig] = parts;
  if (version !== TOKEN_VERSION) return false;
  if (!issuedAtStr || !sig) return false;

  // Verificación HMAC con timing-safe compare para evitar timing attacks
  const expectedSig = sign(`${version}.${issuedAtStr}`);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return false;
  if (Date.now() - issuedAt > MAX_AGE_MS) return false;

  return true;
}

export const COOKIE_NAME = 'cp-session';
export const COOKIE_MAX_AGE_SECONDS = MAX_AGE_MS / 1000;
