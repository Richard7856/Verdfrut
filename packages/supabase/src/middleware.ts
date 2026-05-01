// Helper para crear el cliente Supabase dentro del middleware de Next.js.
// Diseñado para NO depender de tipos concretos de Next — recibe adaptadores
// de cookies para evitar conflictos de versiones entre app y package.

import { createServerClient as createSSRServerClient } from '@supabase/ssr';
import type { Database } from './database';
import type { VerdFrutSupabaseClient } from './types';

export interface MiddlewareCookieAdapter {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: Record<string, unknown>) => void;
}

/**
 * Crea un cliente Supabase para el middleware. Pasa adaptadores de cookies
 * de request (read) y response (write).
 *
 * USO en middleware.ts:
 *   const response = NextResponse.next({ request: req });
 *   const supabase = createMiddlewareClient(req.cookies, response.cookies);
 *   const { data: { user } } = await supabase.auth.getUser();
 */
export function createMiddlewareClient(
  reqCookies: MiddlewareCookieAdapter,
  resCookies: MiddlewareCookieAdapter,
): VerdFrutSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      '[supabase/middleware] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidas',
    );
  }

  return createSSRServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return reqCookies.getAll();
      },
      setAll(
        cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>,
      ) {
        cookies.forEach(({ name, value, options }) => {
          resCookies.set(name, value, options);
        });
      },
    },
  });
}
