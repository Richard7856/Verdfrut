// Cliente Supabase autenticado con un JWT explícito (no cookies).
//
// Útil para Route Handlers que reciben Authorization: Bearer <jwt> en lugar
// de la sesión SSR cookie-based (ej. endpoints expuestos al driver-native).
//
// La verificación del token se hace con supabase.auth.getUser(jwt) — Supabase
// JS v2 lo valida contra el servidor y devuelve el user si es válido.

import { createClient } from '@supabase/supabase-js';
import type { Database } from './database';
import type { VerdFrutSupabaseClient } from './types';

export function createJwtClient(jwt: string): VerdFrutSupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      '[supabase.jwt] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidas',
    );
  }
  return createClient<Database>(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
