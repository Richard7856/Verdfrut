// ADR-095. Helpers de gate por plan que usan los server actions del platform.
//
// Por qué viven aquí (en platform, no en @tripdrive/plans): necesitan
// hablar con Supabase para leer el customer + contar entidades. El
// package @tripdrive/plans es puro (sin Supabase dependency) — esa
// separación facilita testear el mapeo de features sin mocks de BD.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import {
  FeatureNotAvailableError,
  hasFeature,
  hasRoomFor,
  PLAN_LABELS,
  type CustomerStatus,
  type CustomerTier,
  type FeatureKey,
} from '@tripdrive/plans';

interface CustomerGateRow {
  id: string;
  tier: CustomerTier;
  status: CustomerStatus;
  feature_overrides: unknown;
}

/**
 * Lee la fila mínima del customer del usuario logueado para hacer gate.
 *
 * Usa createServerClient (RLS-aware) — el usuario sólo ve su propio
 * customer, así que un attacker no puede forzar un customerId ajeno.
 */
async function readCallerCustomer(): Promise<CustomerGateRow> {
  const supabase = await createServerClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) {
    throw new Error('No autenticado');
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .select('customer_id, customers:customer_id ( id, tier, status, feature_overrides )')
    .eq('id', user.user.id)
    .single();

  if (error || !data) {
    throw new Error(`No se pudo resolver el customer del usuario: ${error?.message ?? 'profile vacío'}`);
  }
  const row = data as unknown as {
    customer_id: string;
    customers: CustomerGateRow | null;
  };
  if (!row.customers) {
    throw new Error('Customer del usuario no encontrado');
  }
  return row.customers;
}

/**
 * Lanza FeatureNotAvailableError si la feature no está habilitada.
 * Server actions deben dejarla bubble — runAction la transforma en
 * un ActionResult con mensaje claro al usuario.
 */
export async function requireCustomerFeature(feature: FeatureKey): Promise<void> {
  const customer = await readCallerCustomer();
  if (!hasFeature(customer, feature)) {
    throw new FeatureNotAvailableError(feature, customer.tier);
  }
}

/**
 * Chequea que el customer tiene cupo para crear `toAdd` tiendas más
 * sin pegar contra el cap de su plan. `count(stores)` se cuenta para
 * el customer del caller — no para todas las tiendas del tenant.
 */
export async function requireRoomForStores(toAdd: number): Promise<void> {
  const customer = await readCallerCustomer();
  const supabase = await createServerClient();
  const { count, error } = await supabase
    .from('stores')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customer.id);
  if (error) {
    throw new Error(`No se pudo contar tiendas: ${error.message}`);
  }
  const current = count ?? 0;
  if (!hasRoomFor(customer, 'maxStoresPerAccount', current, toAdd)) {
    throw new StoreLimitReachedError(customer.tier, current, toAdd);
  }
}

export class StoreLimitReachedError extends Error {
  readonly tier: CustomerTier;
  readonly current: number;
  readonly toAdd: number;

  constructor(tier: CustomerTier, current: number, toAdd: number) {
    super(
      `Tu plan ${PLAN_LABELS[tier]} no permite crear más tiendas ` +
        `(actuales: ${current}, intentas agregar: ${toAdd}). ` +
        `Considera subir a Pro o Enterprise.`,
    );
    this.name = 'StoreLimitReachedError';
    this.tier = tier;
    this.current = current;
    this.toAdd = toAdd;
  }
}
