import 'server-only';

// Cliente Stripe centralizado. Lazy + defensivo:
//  - Si STRIPE_SECRET_KEY no está seteado, devuelve null. Los call-sites
//    deben manejar este caso (no-op gracefully) para que el resto del sistema
//    siga funcionando antes de que Stripe esté configurado.
//  - Re-export del tipo `Stripe` para que callers tipen sin tener que
//    importar el módulo `stripe` directamente.

import StripeNS from 'stripe';

export type StripeClient = StripeNS;

let cached: StripeNS | null | undefined;

/**
 * Devuelve la instancia Stripe o `null` si no hay API key configurada.
 *
 * Por qué null vs throw: en desarrollo / preview sin keys queremos que el
 * sitio levante; sólo las features de billing fallan con mensaje claro.
 * Throw acá rompería pages que ni siquiera tocan billing (ej. middleware).
 */
export function getStripe(): StripeNS | null {
  if (cached !== undefined) return cached;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    cached = null;
    return cached;
  }
  cached = new StripeNS(key, {
    // Omitimos apiVersion para usar la que viene por default en el SDK
    // (la más reciente que el SDK instalado conoce). Pinearla aquí causa
    // type errors cada vez que actualizamos el paquete; el riesgo de breaking
    // change es bajo porque Stripe mantiene compat retro en sus minor bumps.
    typescript: true,
    // App info para logs del dashboard de Stripe.
    appInfo: {
      name: 'TripDrive',
      version: '1.0.0',
      url: 'https://tripdrive.xyz',
    },
  });
  return cached;
}

/**
 * Wrapper para call-sites que SÍ requieren Stripe — UI de billing,
 * endpoints de checkout/webhook. Tira un error explícito si no está
 * configurado para que el dispatcher entienda el problema.
 */
export function requireStripe(): StripeNS {
  const s = getStripe();
  if (!s) {
    throw new Error(
      'Stripe no está configurado. Falta STRIPE_SECRET_KEY en las env vars.',
    );
  }
  return s;
}

/**
 * Modelo de precios Pro tier (ADR-103):
 *  - `base`: licencia Pro mensual que incluye `MIN_ADMINS_INCLUDED` admins
 *    + `MIN_DRIVERS_INCLUDED` choferes. El cliente paga la base aunque tenga
 *    solo 1 admin — es el piso comercial ("desde $9,350/mes" en landing).
 *  - `extraAdmin`: por cada admin/dispatcher activo arriba del mínimo.
 *  - `extraDriver`: por cada chofer activo arriba del mínimo.
 *
 * IMPORTANTE: el "minimum included" NO vive en Stripe — vive en estas
 * constantes. Si decides cambiar el bundle (ej. base incluye 1 admin + 3
 * choferes en lugar de 2+5), actualizas acá y syncSeats recalcula extras
 * en el próximo cambio sin migración.
 */
export const PRO_LICENSE_MIN_ADMINS = 2;
export const PRO_LICENSE_MIN_DRIVERS = 5;

export interface ProPriceIds {
  base: string;
  extraAdmin: string;
  extraDriver: string;
}

export function getPriceIds(): ProPriceIds | null {
  const base = process.env.STRIPE_PRICE_ID_BASE;
  const extraAdmin = process.env.STRIPE_PRICE_ID_EXTRA_ADMIN;
  const extraDriver = process.env.STRIPE_PRICE_ID_EXTRA_DRIVER;
  if (!base || !extraAdmin || !extraDriver) return null;
  return { base, extraAdmin, extraDriver };
}

export function requirePriceIds(): ProPriceIds {
  const ids = getPriceIds();
  if (!ids) {
    throw new Error(
      'Faltan price IDs en env vars: STRIPE_PRICE_ID_BASE, ' +
        'STRIPE_PRICE_ID_EXTRA_ADMIN, STRIPE_PRICE_ID_EXTRA_DRIVER.',
    );
  }
  return ids;
}

/**
 * Calcula extras a cobrar sobre el mínimo incluido en la base. Math.max
 * evita quantities negativas si por alguna razón hay menos seats activos
 * que el mínimo (ej. customer desactivó todos sus drivers, sigue pagando
 * el piso pero no debe cobrarse extras adicionales).
 */
export function computeExtrasFromSeats(adminCount: number, driverCount: number): {
  extraAdmins: number;
  extraDrivers: number;
} {
  return {
    extraAdmins: Math.max(0, adminCount - PRO_LICENSE_MIN_ADMINS),
    extraDrivers: Math.max(0, driverCount - PRO_LICENSE_MIN_DRIVERS),
  };
}

/**
 * URLs de retorno para checkout (success/cancel). Por defecto al
 * /settings/billing del platform — la página acepta `?success=1` o
 * `?canceled=1` para mostrar toasts.
 */
export function getReturnUrls(): { success: string; cancel: string } {
  const base =
    process.env.NEXT_PUBLIC_BILLING_RETURN_URL ??
    process.env.NEXT_PUBLIC_PLATFORM_URL ??
    'http://localhost:3000';
  return {
    success: `${base}/settings/billing?success=1`,
    cancel: `${base}/settings/billing?canceled=1`,
  };
}
