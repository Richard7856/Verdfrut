// Proxy (Next 16) — corre antes de cada request.
// Refresca la sesión Supabase, protege rutas autenticadas, y deja pasar
// las rutas públicas (login, manifest, sw.js, íconos).
//
// Notas:
//   - sw.js debe ser servido sin cookie auth para que el browser pueda
//     instalarlo desde scope='/'. Lo dejamos en PUBLIC_PATHS.
//   - manifest.json y los íconos también son públicos (los pide el browser
//     antes del login para mostrar el banner "Instalar app").

import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient } from '@verdfrut/supabase/middleware';

const PUBLIC_PATHS = [
  '/login',
  '/auth/callback', // Procesa tokens de invite/recovery — debe ser público.
  '/_next',
  '/api/health',
  '/manifest.json',
  '/sw.js',
  '/favicon.ico',
];

const PUBLIC_PREFIXES = ['/icon-', '/apple-touch-icon'];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return false;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Sin credenciales Supabase no podemos validar — dejamos pasar y la app
  // muestra error claro al primer query.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request: req });

  const supabase = createMiddlewareClient(
    {
      getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      set: (name, value, options) => {
        response.cookies.set(name, value, options);
      },
    },
    {
      getAll: () => response.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      set: (name, value, options) => {
        response.cookies.set(name, value, options);
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
};
