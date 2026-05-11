// Helper de tema. Cookie-based para que el server pueda renderizar la marca
// data-theme correcta desde el primer byte (sin flash claro→oscuro).
//
// El toggle (client) escribe la cookie via document.cookie y muta data-theme
// del <html> inline — ningún round-trip al server.
//
// ADR-056 / H6: migración de cookie name `vf-theme` → `td-theme`.
// Para no invalidar preferencias guardadas en navegadores existentes, leemos
// AMBAS cookies con prioridad a la nueva `td-theme`. El toggle escribe la
// nueva. Sprint futuro: dejar de leer la legacy cuando llevemos 30+ días
// productivos (la mayoría de usuarios ya migraron).

import 'server-only';
import { cookies } from 'next/headers';

export type Theme = 'light' | 'dark';
/** Cookie nueva canónica. */
export const THEME_COOKIE = 'td-theme';
/** Cookie legacy — leída para preservar preferencias del primer rebrand. */
export const THEME_COOKIE_LEGACY = 'vf-theme';
const DEFAULT_THEME: Theme = 'light';

export async function getThemeFromCookies(): Promise<Theme> {
  const c = await cookies();
  // Prioridad: la nueva primero. Si solo existe la legacy, usarla.
  const v = c.get(THEME_COOKIE)?.value ?? c.get(THEME_COOKIE_LEGACY)?.value;
  return v === 'dark' ? 'dark' : v === 'light' ? 'light' : DEFAULT_THEME;
}
