// Cliente Supabase para Client Components (corren en el browser).
// Cacheado a nivel de módulo: una sola instancia por sesión de navegador.
//
// USO:
//   'use client'
//   import { createBrowserClient } from '@tripdrive/supabase/browser';
//   const supabase = createBrowserClient();

import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr';
import type { Database } from './database';
import type { VerdFrutSupabaseClient } from './types';

let cachedClient: VerdFrutSupabaseClient | null = null;

/**
 * Crea (o reutiliza) un cliente Supabase para el browser.
 *
 * Multi-tenant: lee NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
 * del environment de la app. Cada deploy de cliente apunta a su propio Supabase.
 *
 * Para apps que sirven múltiples tenants en el mismo deploy (futuro), pasar
 * url/anonKey explícitamente vía createBrowserClientFor(url, anonKey).
 */
export function createBrowserClient(): VerdFrutSupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      '[supabase] NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY no están definidas',
    );
  }

  cachedClient = createSSRBrowserClient<Database>(url, anonKey);
  return cachedClient;
}

/**
 * Crea un cliente para un tenant específico — útil cuando un mismo deploy sirve
 * varios subdominios y el tenant se resuelve en runtime.
 * NO se cachea para evitar mezclar tenants entre sesiones.
 */
export function createBrowserClientFor(
  url: string,
  anonKey: string,
): VerdFrutSupabaseClient {
  return createSSRBrowserClient<Database>(url, anonKey);
}
