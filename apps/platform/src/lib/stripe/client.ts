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
 * IDs de precio para los dos tipos de seat. Validar al inicio del flow
 * de checkout para que el error sea predictivo en vez de "Stripe dice 400".
 */
export function getPriceIds(): { admin: string; driver: string } | null {
  const admin = process.env.STRIPE_PRICE_ID_ADMIN;
  const driver = process.env.STRIPE_PRICE_ID_DRIVER;
  if (!admin || !driver) return null;
  return { admin, driver };
}

export function requirePriceIds(): { admin: string; driver: string } {
  const ids = getPriceIds();
  if (!ids) {
    throw new Error(
      'Faltan STRIPE_PRICE_ID_ADMIN o STRIPE_PRICE_ID_DRIVER en las env vars.',
    );
  }
  return ids;
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
