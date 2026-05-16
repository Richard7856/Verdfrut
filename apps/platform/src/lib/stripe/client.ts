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
 * Modelo de precios por tier (ADR-104, extiende ADR-103):
 *
 * Cada tier (starter | pro | enterprise) tiene 3 line items con sus propios
 * mínimos incluidos en la base. La licencia base es siempre × 1; los extras
 * cobran solo cuando los seats activos exceden el mínimo del tier.
 *
 * Pricing (landing 2026-05-15):
 *   starter (Operación):  $3,270  base = 1 admin + 3 choferes incluidos
 *                         $1,500  /admin extra · $590 /chofer extra
 *   pro:                  $9,350  base = 2 admins + 5 choferes incluidos
 *                         $3,200  /admin extra · $590 /chofer extra
 *   enterprise:           $12,450 base = 2 admins + 5 choferes incluidos
 *                         $4,500  /admin extra · $690 /chofer extra
 *
 * IMPORTANTE: los mínimos viven en código (no en Stripe). Si cambias el
 * bundle, edita las constantes y el próximo syncSeats recalcula extras
 * con proration automática.
 */

export type CustomerTier = 'starter' | 'pro' | 'enterprise';

interface TierConfig {
  minAdmins: number;
  minDrivers: number;
  /** Costo MXN/mes de un admin extra (sobre el mínimo del tier). */
  extraAdminCostMxn: number;
  /** Costo MXN/mes de un chofer extra. */
  extraDriverCostMxn: number;
  envKeyBase: string;
  envKeyExtraAdmin: string;
  envKeyExtraDriver: string;
}

// IMPORTANTE: los costos viven en código (no en Stripe) — los usamos en UI
// para mostrar overage warnings ANTES de invitar (UXR equivalente del billing,
// ADR-111). Si Stripe cambia los precios, actualiza estos números también.
// El monto real cobrado siempre lo dicta Stripe; estos labels son guidance.
const TIER_CONFIG: Record<CustomerTier, TierConfig> = {
  starter: {
    minAdmins: 1,
    minDrivers: 3,
    extraAdminCostMxn: 1500,
    extraDriverCostMxn: 590,
    envKeyBase: 'STRIPE_PRICE_ID_STARTER_BASE',
    envKeyExtraAdmin: 'STRIPE_PRICE_ID_STARTER_EXTRA_ADMIN',
    envKeyExtraDriver: 'STRIPE_PRICE_ID_STARTER_EXTRA_DRIVER',
  },
  pro: {
    minAdmins: 2,
    minDrivers: 5,
    extraAdminCostMxn: 3200,
    extraDriverCostMxn: 590,
    envKeyBase: 'STRIPE_PRICE_ID_PRO_BASE',
    envKeyExtraAdmin: 'STRIPE_PRICE_ID_PRO_EXTRA_ADMIN',
    envKeyExtraDriver: 'STRIPE_PRICE_ID_PRO_EXTRA_DRIVER',
  },
  enterprise: {
    minAdmins: 2,
    minDrivers: 5,
    extraAdminCostMxn: 4500,
    extraDriverCostMxn: 690,
    envKeyBase: 'STRIPE_PRICE_ID_ENTERPRISE_BASE',
    envKeyExtraAdmin: 'STRIPE_PRICE_ID_ENTERPRISE_EXTRA_ADMIN',
    envKeyExtraDriver: 'STRIPE_PRICE_ID_ENTERPRISE_EXTRA_DRIVER',
  },
};

export interface TierPriceIds {
  base: string;
  extraAdmin: string;
  extraDriver: string;
}

export interface TierMinimums {
  minAdmins: number;
  minDrivers: number;
}

/**
 * Mapeo desde el nombre comercial de la landing al enum customer_tier.
 * La landing usa "operacion" en español; BD usa el enum normalizado.
 */
export function planNameToTier(plan: string): CustomerTier {
  if (plan === 'operacion' || plan === 'starter') return 'starter';
  if (plan === 'enterprise') return 'enterprise';
  return 'pro';
}

export function getMinimumsForTier(tier: CustomerTier): TierMinimums {
  const cfg = TIER_CONFIG[tier];
  return { minAdmins: cfg.minAdmins, minDrivers: cfg.minDrivers };
}

/**
 * Costos MXN/mes de un seat extra del tier dado. Usado por el overage warning
 * de invite (ADR-111). El cobro real lo determina Stripe — esto es solo label.
 */
export function getExtraCostsForTier(
  tier: CustomerTier,
): { extraAdminCostMxn: number; extraDriverCostMxn: number } {
  const cfg = TIER_CONFIG[tier];
  return {
    extraAdminCostMxn: cfg.extraAdminCostMxn,
    extraDriverCostMxn: cfg.extraDriverCostMxn,
  };
}

/**
 * Devuelve los 3 price IDs del tier o null si alguno falta en env. Útil para
 * UI defensiva (mostrar warning sin tirar) y para validar al inicio del flow
 * antes de pegarle a Stripe.
 */
export function getPriceIdsForTier(tier: CustomerTier): TierPriceIds | null {
  const cfg = TIER_CONFIG[tier];
  const base = process.env[cfg.envKeyBase];
  const extraAdmin = process.env[cfg.envKeyExtraAdmin];
  const extraDriver = process.env[cfg.envKeyExtraDriver];
  if (!base || !extraAdmin || !extraDriver) return null;
  return { base, extraAdmin, extraDriver };
}

export function requirePriceIdsForTier(tier: CustomerTier): TierPriceIds {
  const ids = getPriceIdsForTier(tier);
  if (!ids) {
    const cfg = TIER_CONFIG[tier];
    throw new Error(
      `Faltan price IDs del tier ${tier} en env vars: ${cfg.envKeyBase}, ${cfg.envKeyExtraAdmin}, ${cfg.envKeyExtraDriver}.`,
    );
  }
  return ids;
}

/**
 * Health-check: ¿al menos un tier tiene todos sus price IDs configurados?
 * UI de /settings/billing y /empezar lo usan para decidir si mostrar el flow
 * o un warning amable. Sin ningún tier configurado, billing es invisible.
 */
export function anyTierConfigured(): boolean {
  return (
    getPriceIdsForTier('starter') !== null ||
    getPriceIdsForTier('pro') !== null ||
    getPriceIdsForTier('enterprise') !== null
  );
}

/**
 * Calcula extras a cobrar sobre el mínimo del tier. Math.max evita quantities
 * negativas — si un customer desactiva todos sus seats, sigue pagando el piso
 * de la base pero no se le cobran extras adicionales.
 */
export function computeExtrasFromSeats(
  adminCount: number,
  driverCount: number,
  tier: CustomerTier,
): { extraAdmins: number; extraDrivers: number } {
  const { minAdmins, minDrivers } = getMinimumsForTier(tier);
  return {
    extraAdmins: Math.max(0, adminCount - minAdmins),
    extraDrivers: Math.max(0, driverCount - minDrivers),
  };
}

// ─── Aliases legacy ──────────────────────────────────────────────────
// Antes (ADR-103) el código asumía un solo tier (Pro). Estos exports se
// mantienen para que callers que aún no migraron sigan compilando, pero
// internamente delegan al tier "pro" para preservar comportamiento.

/** @deprecated usa getMinimumsForTier(tier) */
export const PRO_LICENSE_MIN_ADMINS = TIER_CONFIG.pro.minAdmins;
/** @deprecated usa getMinimumsForTier(tier) */
export const PRO_LICENSE_MIN_DRIVERS = TIER_CONFIG.pro.minDrivers;

/** @deprecated usa getPriceIdsForTier(tier) */
export function getPriceIds(): TierPriceIds | null {
  return getPriceIdsForTier('pro');
}

/** @deprecated usa requirePriceIdsForTier(tier) */
export function requirePriceIds(): TierPriceIds {
  return requirePriceIdsForTier('pro');
}

/**
 * URLs de retorno para checkout (success/cancel). Resuelve la base URL en
 * este orden:
 *   1. `NEXT_PUBLIC_BILLING_RETURN_URL` (override explícito)
 *   2. `NEXT_PUBLIC_PLATFORM_URL` (URL canónica del platform)
 *   3. Headers del request actual (host + proto) — robusto en Vercel
 *      donde el dominio puede variar entre prod/preview/branch deploys.
 *   4. `http://localhost:3000` como último fallback.
 *
 * El path por defecto va a /settings/billing; los call-sites pueden
 * override con `pathOverride` (ej. signup público redirige a /empezar).
 */
export function getReturnUrls(opts?: {
  reqHeaders?: Headers;
  pathOverride?: string;
}): { success: string; cancel: string } {
  let base =
    process.env.NEXT_PUBLIC_BILLING_RETURN_URL ??
    process.env.NEXT_PUBLIC_PLATFORM_URL;

  if (!base && opts?.reqHeaders) {
    const host = opts.reqHeaders.get('host');
    const proto = opts.reqHeaders.get('x-forwarded-proto') ?? 'https';
    if (host) base = `${proto}://${host}`;
  }

  if (!base) base = 'http://localhost:3000';

  const path = opts?.pathOverride ?? '/settings/billing';
  return {
    success: `${base}${path}?success=1`,
    cancel: `${base}${path}?canceled=1`,
  };
}
