// ADR-126 — helpers de cuota AI mensual (Fase 2).
//
// Responsabilidades:
//   - `checkAiQuota(kind)`: lee cuota usada + límite del tier del caller.
//     NO incrementa. Útil para mostrar banner UI ANTES del request.
//   - `consumeAiQuota(kind)`: incrementa atómicamente vía RPC + devuelve
//     status. Usar en hot path (server actions, API routes) cuando se
//     consume una sesión o write.
//   - `QuotaExceededError`: error tipado para soft-block (devolver mensaje
//     legible al user, NO crashear el flow).
//
// Diseño:
//   - Cuota soft (warning + soft-block en writes): si la sesión arranca con
//     cuota agotada, devolvemos error legible. Lecturas (read tools) no se
//     gateán — el chat puede seguir consultando.
//   - Reads NO consumen cuota. Solo `sessions` (1 vez al crear) y `writes`
//     (1 vez por cada WRITE_TOOL exitoso).
//   - El servidor de la app es la fuente de verdad — el cliente solo
//     refleja status via /settings/billing.

import 'server-only';
import { createServerClient, createServiceRoleClient } from '@tripdrive/supabase/server';
import {
  getEffectiveFeatures,
  PLAN_LABELS,
  type CustomerStatus,
  type CustomerTier,
} from '@tripdrive/plans';

export type QuotaKind = 'sessions' | 'writes';

export interface QuotaStatus {
  ok: boolean;
  kind: QuotaKind;
  used: number;
  /** Infinity si tier ilimitado (Enterprise). */
  limit: number;
  /** Infinity si tier ilimitado. */
  remaining: number;
  /** True si >= 80% — el caller renderea banner warning. */
  warn: boolean;
  /** Cuándo arranca el siguiente período (próximo 1ro del mes). */
  resetsAt: Date;
}

export class QuotaExceededError extends Error {
  readonly kind: QuotaKind;
  readonly tier: CustomerTier;
  readonly used: number;
  readonly limit: number;

  constructor(kind: QuotaKind, tier: CustomerTier, used: number, limit: number) {
    super(
      `Cuota AI ${kind} agotada para plan ${PLAN_LABELS[tier]} (${used}/${limit} este mes). ` +
        `Renueva el 1° del próximo mes o actualiza a Enterprise para ilimitado.`,
    );
    this.name = 'QuotaExceededError';
    this.kind = kind;
    this.tier = tier;
    this.used = used;
    this.limit = limit;
  }
}

interface CustomerQuotaRow {
  id: string;
  tier: CustomerTier;
  status: CustomerStatus;
  feature_overrides: unknown;
  ai_sessions_used_month: number;
  ai_writes_used_month: number;
  ai_quota_period_starts_at: string;
}

/**
 * Resuelve el customer del caller con los campos de cuota.
 * Usa RLS-aware client — el user solo ve su propio customer.
 */
async function readCallerCustomerQuota(): Promise<CustomerQuotaRow> {
  const supabase = await createServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) throw new Error('No autenticado');

  const { data, error } = await supabase
    .from('user_profiles')
    .select(
      'customer_id, customers:customer_id ( id, tier, status, feature_overrides, ai_sessions_used_month, ai_writes_used_month, ai_quota_period_starts_at )',
    )
    .eq('id', user.user.id)
    .single();
  if (error || !data) {
    throw new Error(`No se pudo resolver customer del usuario: ${error?.message ?? 'profile vacío'}`);
  }
  const row = data as unknown as { customers: CustomerQuotaRow | null };
  if (!row.customers) throw new Error('Customer del usuario no encontrado');
  return row.customers;
}

/**
 * Computa el próximo reset: primer día del mes siguiente al período actual.
 */
function computeResetsAt(periodStartsAt: string): Date {
  const start = new Date(periodStartsAt);
  // Próximo mes desde la fecha de inicio del período.
  const reset = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0));
  return reset;
}

/**
 * Lee el status actual de cuota SIN incrementar. Para banners UI y /settings/billing.
 */
export async function checkAiQuota(kind: QuotaKind): Promise<QuotaStatus> {
  const customer = await readCallerCustomerQuota();
  return statusFromRow(customer, kind, kind === 'sessions' ? customer.ai_sessions_used_month : customer.ai_writes_used_month);
}

/**
 * Lee status para ambos kinds en una sola query. Útil para /settings/billing.
 */
export async function checkAiQuotaBoth(): Promise<{ sessions: QuotaStatus; writes: QuotaStatus }> {
  const customer = await readCallerCustomerQuota();
  return {
    sessions: statusFromRow(customer, 'sessions', customer.ai_sessions_used_month),
    writes: statusFromRow(customer, 'writes', customer.ai_writes_used_month),
  };
}

function statusFromRow(
  customer: CustomerQuotaRow,
  kind: QuotaKind,
  used: number,
): QuotaStatus {
  const features = getEffectiveFeatures(customer);
  const limit =
    kind === 'sessions' ? features.maxAiSessionsPerMonth : features.maxAiWritesPerMonth;
  const remaining = Math.max(0, limit - used);
  const ok = used < limit;
  // Warning al 80% — el caller decide si renderear banner.
  const warn = Number.isFinite(limit) && limit > 0 && used / limit >= 0.8;
  return {
    ok,
    kind,
    used,
    limit,
    remaining,
    warn,
    resetsAt: computeResetsAt(customer.ai_quota_period_starts_at),
  };
}

/**
 * Incrementa atómicamente la cuota vía RPC `consume_ai_quota` y devuelve el
 * nuevo status. Si el incremento NO cabe en el límite del tier, lanza
 * `QuotaExceededError` PERO solo después de haber consumido — el patrón es:
 *
 *   - Sessions: incrementar al inicio de cada nueva sesión. Si excede, el
 *     caller decide bloquear el chat o avisar.
 *   - Writes: incrementar antes de ejecutar el tool. Si excede, devolver
 *     error al modelo (queda como tool_use_result fallido).
 *
 * Defensa: si el customer no tiene AI habilitado (Starter), lanza inmediato
 * sin tocar la BD — Sentinel.
 */
export async function consumeAiQuota(kind: QuotaKind): Promise<QuotaStatus> {
  const customer = await readCallerCustomerQuota();
  const features = getEffectiveFeatures(customer);
  if (!features.ai) {
    // Defensa: el chat ya hizo el gate `requireCustomerFeature('ai')` pero
    // bypass aquí es belt-and-suspenders.
    throw new QuotaExceededError(kind, customer.tier, 0, 0);
  }

  // Si tier es ilimitado (Infinity), no consultamos la BD — incrementar el
  // contador es informativo pero no bloquea. Para Enterprise no necesitamos
  // el round-trip. Devolvemos un status sintético.
  const limit =
    kind === 'sessions' ? features.maxAiSessionsPerMonth : features.maxAiWritesPerMonth;
  if (!Number.isFinite(limit)) {
    // Aun así incrementamos para tracking (analytics post-hoc). Service role
    // para evitar issues de RLS con UPDATE atómico desde el caller del chat.
    const admin = createServiceRoleClient();
    await admin.rpc('consume_ai_quota', { p_customer_id: customer.id, p_kind: kind });
    return {
      ok: true,
      kind,
      used:
        (kind === 'sessions' ? customer.ai_sessions_used_month : customer.ai_writes_used_month) + 1,
      limit: Infinity,
      remaining: Infinity,
      warn: false,
      resetsAt: computeResetsAt(customer.ai_quota_period_starts_at),
    };
  }

  // Tier con cap finito (Pro). Incrementar atómico + verificar contra límite.
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc('consume_ai_quota', {
    p_customer_id: customer.id,
    p_kind: kind,
  });
  if (error) {
    // Si el RPC falla (raro), NO bloqueamos al user — log y permitir.
    // Mejor over-deliver que tirar el chat por un error de telemetría.
    return {
      ok: true,
      kind,
      used:
        (kind === 'sessions' ? customer.ai_sessions_used_month : customer.ai_writes_used_month) + 1,
      limit,
      remaining: Math.max(
        0,
        limit -
          ((kind === 'sessions' ? customer.ai_sessions_used_month : customer.ai_writes_used_month) +
            1),
      ),
      warn: true,
      resetsAt: computeResetsAt(customer.ai_quota_period_starts_at),
    };
  }
  const rows = (data as unknown as Array<{ used: number; period_starts_at: string }> | null) ?? [];
  const row = rows[0];
  const newUsed = row?.used ?? 0;
  const period = row?.period_starts_at ?? customer.ai_quota_period_starts_at;
  const ok = newUsed <= limit;
  if (!ok) {
    throw new QuotaExceededError(kind, customer.tier, newUsed, limit);
  }
  return {
    ok: true,
    kind,
    used: newUsed,
    limit,
    remaining: Math.max(0, limit - newUsed),
    warn: newUsed / limit >= 0.8,
    resetsAt: computeResetsAt(period),
  };
}
