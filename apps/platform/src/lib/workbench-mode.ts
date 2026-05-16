// Helper server-side para el modo Workbench (ADR-112).
//
// El modo se persiste en una cookie HTTP `tripdrive-mode=sandbox` (o ausente
// = real). Todas las queries y server actions consultan getCurrentMode() para
// decidir si filtran/escriben en el espacio operativo real o en el sandbox
// compartido del customer.
//
// Por qué cookie en vez de URL param:
//   - El modo aplica a toda la navegación (no solo a una página).
//   - Server actions tienen el cookie disponible sin re-pasar el flag.
//   - El toggle es persistente entre tabs/recargas del mismo navegador.
//
// Por qué NO en BD:
//   - El modo es por-sesión-del-admin, no global del customer. Dos admins
//     del mismo cliente pueden estar uno en sandbox y otro en real al mismo
//     tiempo, viendo cada uno lo suyo.

import 'server-only';
import { cookies } from 'next/headers';

export type WorkbenchMode = 'real' | 'sandbox';

const COOKIE_NAME = 'tripdrive-mode';

/**
 * Lee la cookie y devuelve el modo actual. Default 'real' si no hay cookie
 * o si tiene un valor desconocido.
 */
export async function getCurrentMode(): Promise<WorkbenchMode> {
  const store = await cookies();
  const v = store.get(COOKIE_NAME)?.value;
  return v === 'sandbox' ? 'sandbox' : 'real';
}

/**
 * Setea la cookie. Llamar desde un Server Action al cambiar el toggle.
 * - HTTP-only desactivado a propósito: hacks como un mini-extension debug
 *   del navegador pueden inspeccionarla sin riesgo (no es secret).
 * - SameSite=lax para que sobreviva navegaciones internas pero no se filtre
 *   cross-site.
 * - Max-age 30 días — el modo es "sticky" hasta que el admin lo cambie.
 */
export async function setMode(mode: WorkbenchMode): Promise<void> {
  const store = await cookies();
  if (mode === 'real') {
    // Para volver a real, mejor borramos la cookie (cleanup).
    store.delete(COOKIE_NAME);
    return;
  }
  store.set(COOKIE_NAME, mode, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
    // No httpOnly: el toggle UI necesita poder leer el estado actual
    // server-side, pero también es útil que el cliente lo pueda inspeccionar
    // para indicadores en runtime sin server round-trip.
    httpOnly: false,
  });
}

/**
 * Atajo para componentes que solo necesitan saber si el sandbox está activo.
 */
export async function isSandboxMode(): Promise<boolean> {
  return (await getCurrentMode()) === 'sandbox';
}
