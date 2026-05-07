// Helper de tema. Cookie-based para que el server pueda renderizar la marca
// data-theme correcta desde el primer byte (sin flash claro→oscuro).
//
// El toggle (client) escribe la cookie via document.cookie y muta data-theme
// del <html> inline — ningún round-trip al server.

import 'server-only';
import { cookies } from 'next/headers';

export type Theme = 'light' | 'dark';
export const THEME_COOKIE = 'vf-theme';
const DEFAULT_THEME: Theme = 'light';

export async function getThemeFromCookies(): Promise<Theme> {
  const c = await cookies();
  const v = c.get(THEME_COOKIE)?.value;
  return v === 'dark' ? 'dark' : v === 'light' ? 'light' : DEFAULT_THEME;
}
