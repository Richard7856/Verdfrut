// Cliente Supabase para Server Components, Server Actions y Route Handlers de Next.js.
// NO se cachea: cada request crea uno nuevo (los cookies son per-request).
//
// USO:
//   import { createServerClient } from '@tripdrive/supabase/server';
//   const supabase = await createServerClient();

import { createServerClient as createSSRServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database';
import type { VerdFrutSupabaseClient } from './types';
export { createJwtClient } from './jwt-client';

/**
 * Crea un cliente Supabase para el server.
 *
 * Solo válido dentro del runtime de Next.js (Server Components, Server Actions,
 * Route Handlers, Proxy). Para scripts/cron/webhooks usar `createServiceRoleClient`.
 */
export async function createServerClient(): Promise<VerdFrutSupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidas',
    );
  }

  // Turbopack (Next 16) no soporta el truco de webpackIgnore para next/headers.
  // Import estático directo: este archivo solo corre en Next.
  const cookieStore = await cookies();

  return createSSRServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookies: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
        try {
          cookies.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll puede fallar en Server Components puros (sin response).
          // Es seguro ignorar — el middleware refresca la sesión.
        }
      },
    },
  });
}

/**
 * Cliente con service role key — bypass RLS. Usar SOLO en código server-side
 * confiable (cron jobs, webhooks internos). Nunca exponer al cliente.
 */
export function createServiceRoleClient(): VerdFrutSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no están definidas',
    );
  }

  // Usamos createServerClient con cookies vacíos — no necesitamos sesión.
  return createSSRServerClient<Database>(url, serviceKey, {
    cookies: {
      getAll: () => [],
      setAll: () => {
        /* no-op */
      },
    },
  });
}

