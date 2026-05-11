// Proxy (Next 16) — corre ANTES de cada request. Equivalente al antiguo middleware.
// Responsabilidades:
//   1. Resolver el tenant desde el subdomain (futuro, cuando hagamos multi-deploy single-instance)
//   2. Refrescar la sesión Supabase si el token está por vencer
//   3. Proteger rutas autenticadas (redirect a /login si no hay sesión)
//
// V1: confiamos en NEXT_PUBLIC_TENANT_SLUG del env (un deploy por tenant).
// El registro de tenants y resolución por subdomain se activa en Fase 6 (control plane).

import { NextResponse, type NextRequest } from 'next/server';
import { createMiddlewareClient } from '@tripdrive/supabase/middleware';

const PUBLIC_PATHS = ['/login', '/_next', '/favicon.ico', '/api/health'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  // Si no hay credenciales Supabase configuradas (caso desarrollo sin .env),
  // dejar pasar — la app misma mostrará un error claro al hacer el primer query.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.next();
  }

  const response = NextResponse.next({ request: req });

  // Adaptamos las cookies de Next a la interface esperada por @tripdrive/supabase.
  // El package no depende de tipos de Next para evitar conflictos de versiones.
  const supabase = createMiddlewareClient(
    {
      getAll: () => req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      set: (name, value, options) => {
        // Las options de cookies de Supabase incluyen propiedades como maxAge, path, etc.
        // que coinciden con las de Next CookieOptions.
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

  // getUser fuerza una validación contra el server (no solo lee la cookie).
  // Esto refresca el token si está por vencer.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sin sesión → redirect a /login conservando el path original como ?next=.
  if (!user) {
    const loginUrl = new URL('/login', req.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Todo excepto: archivos estáticos, _next, favicon, robots, imágenes
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico)$).*)',
  ],
};
