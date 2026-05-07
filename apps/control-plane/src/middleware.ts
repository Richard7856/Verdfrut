// Middleware del Control Plane — Sprint 17.
//
// Protege TODAS las rutas excepto:
//   - /login (formulario para obtener cookie firmada)
//   - /api/health (heartbeat para monitoreo externo)
//
// Sin cookie válida → redirect a /login con ?next= para volver tras autenticar.
// La verificación HMAC se hace inline (no llamamos a `verifyToken` del lib porque
// el middleware corre en Edge runtime y `node:crypto` no está disponible —
// usamos Web Crypto API).

import { NextResponse, type NextRequest } from 'next/server';

const COOKIE_NAME = 'cp-session';
const TOKEN_VERSION = 'v1';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const PUBLIC_PATHS = ['/login', '/api/health'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rutas públicas pasan directo
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }
  // Static assets de Next pasan directo (el matcher abajo los excluye, esta línea
  // es defensa adicional)
  if (pathname.startsWith('/_next/') || pathname === '/favicon.ico') {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const valid = await verifyTokenEdge(token);
  if (valid) return NextResponse.next();

  const loginUrl = new URL('/login', req.url);
  if (pathname !== '/') loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

async function verifyTokenEdge(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [version, issuedAtStr, sig] = parts;
  if (version !== TOKEN_VERSION || !issuedAtStr || !sig) return false;

  const issuedAt = parseInt(issuedAtStr, 10);
  if (isNaN(issuedAt)) return false;
  if (Date.now() - issuedAt > MAX_AGE_MS) return false;

  const secret = process.env.CP_COOKIE_SECRET;
  if (!secret) return false;

  // HMAC-SHA256 vía Web Crypto (Edge runtime)
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(`${version}.${issuedAtStr}`));
  const expectedSig = bytesToBase64Url(new Uint8Array(sigBytes));

  // Timing-safe-ish compare (Edge no expone timingSafeEqual; aceptable para HMAC tokens
  // ya que un atacante necesitaría predecir HMAC entero, no diff bit a bit)
  if (sig.length !== expectedSig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expectedSig.charCodeAt(i);
  return diff === 0;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Skipping Next internals y archivos públicos. El middleware corre para todo lo demás.
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-.*\\.png|apple-touch-icon\\.png).*)'],
};
