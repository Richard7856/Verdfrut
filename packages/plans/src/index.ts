// @tripdrive/plans — ADR-095.
//
// Mapeo de tier (DB enum) → features habilitadas + helpers para checkear
// gates. Sin dependencia directa a Supabase: recibe la fila de customer
// como argumento y devuelve el effective feature set.
//
// Por qué keys agnósticas (ej. `ai` en lugar de `orchestrator`): el
// nombre comercial puede cambiar pero la feature es la misma. Si
// renombramos el orquestador a "Copiloto AI" mañana, los gates no
// se mueven.

export type CustomerTier = 'starter' | 'pro' | 'enterprise';
export type CustomerStatus = 'active' | 'demo' | 'paused' | 'churned';

/**
 * Plan features — todos los flags + límites cuantitativos.
 *
 * `Infinity` se permite para límites unbounded. Los gates usan
 * comparadores `<` que aceptan Infinity sin caso especial.
 */
export interface PlanFeatures {
  /** Asistente AI conversacional (orquestador con 19 tools). */
  ai: boolean;
  /** ADR-126: máximo de sesiones AI por mes. Infinity = ilimitado. */
  maxAiSessionsPerMonth: number;
  /** ADR-126: máximo de tool calls write (mutantes) por mes. Infinity = ilimitado. */
  maxAiWritesPerMonth: number;
  /** Máximo de "cuentas operativas" (child customers logical units). */
  maxAccounts: number;
  /** Máximo de tiendas por cuenta operativa. */
  maxStoresPerAccount: number;
  /** Permite dominio propio del cliente (app.empresa.com). */
  customDomain: boolean;
  /** Permite branding personalizado (logo, colores). */
  customBranding: boolean;
  /** XLSX/CSV import vía chat del asistente. */
  xlsxImport: boolean;
  /** Mapa interactivo con drag-to-edit de tiendas. */
  dragEditMap: boolean;
  /** Push notifications (web + Android). */
  pushNotifications: boolean;
  /** Re-optimización en vivo de rutas. */
  liveReOpt: boolean;
}

export type FeatureKey = keyof PlanFeatures;

/**
 * Sets de features por tier. Mantener alineado con la landing
 * comercial — cualquier cambio aquí afecta lo que prometemos.
 *
 * Si necesitas regalar una feature a un cliente puntual, usa
 * `feature_overrides` en la fila de `customers` — no edites
 * este mapeo (rompería el contrato comercial).
 */
export const PLAN_FEATURES: Record<CustomerTier, PlanFeatures> = {
  starter: {
    ai: false,
    maxAiSessionsPerMonth: 0,
    maxAiWritesPerMonth: 0,
    maxAccounts: 1,
    maxStoresPerAccount: 150,
    customDomain: false,
    customBranding: false,
    xlsxImport: false,
    dragEditMap: false,
    pushNotifications: true,
    liveReOpt: true,
  },
  pro: {
    ai: true,
    // ADR-126: cuota mensual alineada con copy de landing ("300 sesiones/mes").
    // 500 writes/mes cubre uso típico (~17/día) y deja espacio antes del cap.
    // Cuando llegue telemetría real, ajustar al p75 del consumo observado.
    maxAiSessionsPerMonth: 300,
    maxAiWritesPerMonth: 500,
    maxAccounts: 3,
    maxStoresPerAccount: 600,
    customDomain: false,
    customBranding: false,
    xlsxImport: true,
    dragEditMap: true,
    pushNotifications: true,
    liveReOpt: true,
  },
  enterprise: {
    ai: true,
    maxAiSessionsPerMonth: Number.POSITIVE_INFINITY,
    maxAiWritesPerMonth: Number.POSITIVE_INFINITY,
    maxAccounts: Number.POSITIVE_INFINITY,
    maxStoresPerAccount: Number.POSITIVE_INFINITY,
    customDomain: true,
    customBranding: true,
    xlsxImport: true,
    dragEditMap: true,
    pushNotifications: true,
    liveReOpt: true,
  },
};

/**
 * Labels para UI. La BD usa `starter` pero comercialmente lo
 * llamamos "Operación". Centralizar acá evita strings sueltos.
 */
export const PLAN_LABELS: Record<CustomerTier, string> = {
  starter: 'Operación',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

/**
 * Descripción corta del tier para la UI.
 */
export const PLAN_DESCRIPTIONS: Record<CustomerTier, string> = {
  starter: '1 cuenta operativa · sin asistente AI',
  pro: 'Hasta 3 cuentas · asistente AI ilimitado',
  enterprise: 'Cuentas ilimitadas · dominio y branding propios',
};

/**
 * Pricing comercial — alineado con landing. Sólo para mostrar
 * en la UI; el cobro real lo lleva `monthly_fee_mxn`.
 */
export const PLAN_PRICING_MXN: Record<
  CustomerTier,
  { perAdmin: number; perDriver: number; minAdmins: number; minDrivers: number }
> = {
  starter: { perAdmin: 1500, perDriver: 590, minAdmins: 1, minDrivers: 3 },
  pro: { perAdmin: 3200, perDriver: 590, minAdmins: 2, minDrivers: 5 },
  enterprise: { perAdmin: 4500, perDriver: 690, minAdmins: 2, minDrivers: 5 },
};

/**
 * Lista de feature keys conocidas — para validar overrides
 * y para iterar en UI de toggles. `Set` para look-ups O(1).
 */
export const KNOWN_FEATURE_KEYS: ReadonlySet<FeatureKey> = new Set([
  'ai',
  'maxAiSessionsPerMonth',
  'maxAiWritesPerMonth',
  'maxAccounts',
  'maxStoresPerAccount',
  'customDomain',
  'customBranding',
  'xlsxImport',
  'dragEditMap',
  'pushNotifications',
  'liveReOpt',
]);

/**
 * Features que tiene sentido togglear desde UI (excluye los
 * cuantitativos como maxAccounts que se manejan con campos
 * numéricos aparte).
 */
export const TOGGLEABLE_FEATURE_KEYS: readonly FeatureKey[] = [
  'ai',
  'customDomain',
  'customBranding',
  'xlsxImport',
  'dragEditMap',
  'pushNotifications',
  'liveReOpt',
] as const;

/**
 * Sanitiza un objeto de overrides — descarta keys desconocidas
 * y valida tipos. Evita que un override mal formado rompa el
 * runtime cuando lo lee `getEffectiveFeatures`.
 */
export function sanitizeFeatureOverrides(
  raw: unknown,
): Partial<PlanFeatures> {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const out: Partial<PlanFeatures> = {};

  const NUMERIC_KEYS = new Set<FeatureKey>([
    'maxAccounts',
    'maxStoresPerAccount',
    'maxAiSessionsPerMonth',
    'maxAiWritesPerMonth',
  ]);
  for (const key of KNOWN_FEATURE_KEYS) {
    if (!(key in input)) continue;
    const v = input[key];
    if (NUMERIC_KEYS.has(key)) {
      // Aceptamos number o 'unlimited' como string especial.
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        (out as Record<string, unknown>)[key] = v;
      } else if (v === 'unlimited' || v === Infinity) {
        (out as Record<string, unknown>)[key] = Number.POSITIVE_INFINITY;
      }
    } else {
      if (typeof v === 'boolean') {
        (out as Record<string, unknown>)[key] = v;
      }
    }
  }

  return out;
}

/**
 * Input shape para `getEffectiveFeatures`. Acepta cualquier
 * objeto con esos campos — funciona con el row de Supabase
 * tal cual.
 */
export interface CustomerForFeatures {
  tier: CustomerTier;
  status: CustomerStatus;
  feature_overrides?: unknown;
}

/**
 * Devuelve el set efectivo de features para un customer.
 *
 * Regla:
 *   - status `churned` o `paused` → features mínimas (todo `false`
 *     y límites en 0). El customer no puede operar.
 *   - status `demo` → mismo que `active` (los demos sí prueban
 *     todas las features del tier que les asignes).
 *   - Overrides aplicados encima del default del tier.
 */
export function getEffectiveFeatures(c: CustomerForFeatures): PlanFeatures {
  if (c.status === 'churned' || c.status === 'paused') {
    return {
      ai: false,
      maxAiSessionsPerMonth: 0,
      maxAiWritesPerMonth: 0,
      maxAccounts: 0,
      maxStoresPerAccount: 0,
      customDomain: false,
      customBranding: false,
      xlsxImport: false,
      dragEditMap: false,
      pushNotifications: false,
      liveReOpt: false,
    };
  }

  const base = PLAN_FEATURES[c.tier];
  const overrides = sanitizeFeatureOverrides(c.feature_overrides);
  return { ...base, ...overrides };
}

/**
 * Checkea una sola feature booleana. Helper común para gates
 * en server actions y API routes.
 */
export function hasFeature(c: CustomerForFeatures, feature: FeatureKey): boolean {
  const eff = getEffectiveFeatures(c);
  const value = eff[feature];
  return typeof value === 'boolean' ? value : value > 0;
}

/**
 * Helper para chequeo de límite — devuelve `true` si el customer
 * puede crear N más antes de pegar contra el cap.
 */
export function hasRoomFor(
  c: CustomerForFeatures,
  feature: 'maxAccounts' | 'maxStoresPerAccount',
  currentCount: number,
  toAdd = 1,
): boolean {
  const eff = getEffectiveFeatures(c);
  const limit = eff[feature];
  return currentCount + toAdd <= limit;
}

/**
 * Error tipado para fallo de gate — la app web puede mapearlo a
 * 403 con mensaje específico al feature que falló.
 */
export class FeatureNotAvailableError extends Error {
  readonly feature: FeatureKey;
  readonly tier: CustomerTier;

  constructor(feature: FeatureKey, tier: CustomerTier) {
    super(
      `Feature "${String(feature)}" no disponible en plan ${PLAN_LABELS[tier]}. ` +
        `Habla con ventas para activarla.`,
    );
    this.name = 'FeatureNotAvailableError';
    this.feature = feature;
    this.tier = tier;
  }
}

/**
 * Versión que lanza el error tipado — útil cuando el caller
 * prefiere try/catch sobre branch manual.
 */
export function requireFeature(c: CustomerForFeatures, feature: FeatureKey): void {
  if (!hasFeature(c, feature)) {
    throw new FeatureNotAvailableError(feature, c.tier);
  }
}
