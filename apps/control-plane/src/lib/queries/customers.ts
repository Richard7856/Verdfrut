// Queries de customers — Fase A2 del Stream A (ADR-086).
//
// Los customers viven en el tenant project compartido (schema `public`),
// no en el control_plane schema. El Control Plane usa service_role (mismo
// proyecto Supabase) para verlos cross-customer bypaseando la RLS
// `customers_select` que restringe a "tu propio customer".

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import type { TableUpdate } from '@tripdrive/supabase';

export type CustomerStatus = 'active' | 'paused' | 'churned' | 'demo';
export type CustomerTier = 'starter' | 'pro' | 'enterprise';

export interface Customer {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  rfc: string | null;
  status: CustomerStatus;
  tier: CustomerTier;
  timezone: string;
  brandColorPrimary: string | null;
  brandLogoUrl: string | null;
  monthlyFeeMxn: number | null;
  perDriverFeeMxn: number | null;
  contractStartedAt: string | null;
  contractEndsAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  rfc: string | null;
  status: CustomerStatus;
  tier: CustomerTier;
  timezone: string;
  brand_color_primary: string | null;
  brand_logo_url: string | null;
  monthly_fee_mxn: number | null;
  per_driver_fee_mxn: number | null;
  contract_started_at: string | null;
  contract_ends_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const CUSTOMER_COLS = `
  id, slug, name, legal_name, rfc, status, tier, timezone,
  brand_color_primary, brand_logo_url,
  monthly_fee_mxn, per_driver_fee_mxn,
  contract_started_at, contract_ends_at,
  notes, created_at, updated_at
`;

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    rfc: row.rfc,
    status: row.status,
    tier: row.tier,
    timezone: row.timezone,
    brandColorPrimary: row.brand_color_primary,
    brandLogoUrl: row.brand_logo_url,
    monthlyFeeMxn: row.monthly_fee_mxn,
    perDriverFeeMxn: row.per_driver_fee_mxn,
    contractStartedAt: row.contract_started_at,
    contractEndsAt: row.contract_ends_at,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomers(opts?: { status?: CustomerStatus }): Promise<Customer[]> {
  let q = createServiceRoleClient().from('customers').select(CUSTOMER_COLS).order('name');
  if (opts?.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) throw new Error(`[cp.customers.list] ${error.message}`);
  return (data ?? []).map((row) => toCustomer(row as unknown as CustomerRow));
}

export async function getCustomerBySlug(slug: string): Promise<Customer | null> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`[cp.customers.getBySlug] ${error.message}`);
  return data ? toCustomer(data as unknown as CustomerRow) : null;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`[cp.customers.getById] ${error.message}`);
  return data ? toCustomer(data as unknown as CustomerRow) : null;
}

// KPIs operativos del customer: cuenta de entidades en su tenant compartido.
// Tabla operativa filtrada por customer_id (post-mig 037). Reads en paralelo.
export interface CustomerOpsCounts {
  zones: number;
  depots: number;
  stores: number;
  vehicles: number;
  drivers: number;
  users: number;
  activeRoutes: number;
  dispatchesLast30d: number;
}

export async function getCustomerOpsCounts(customerId: string): Promise<CustomerOpsCounts> {
  const sb = createServiceRoleClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const counts = await Promise.all([
    sb.from('zones').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('depots').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('stores').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('vehicles').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('drivers').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('user_profiles').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('routes').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['PUBLISHED', 'IN_PROGRESS']),
    sb.from('dispatches').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .gte('created_at', since),
  ]);

  return {
    zones: counts[0].count ?? 0,
    depots: counts[1].count ?? 0,
    stores: counts[2].count ?? 0,
    vehicles: counts[3].count ?? 0,
    drivers: counts[4].count ?? 0,
    users: counts[5].count ?? 0,
    activeRoutes: counts[6].count ?? 0,
    dispatchesLast30d: counts[7].count ?? 0,
  };
}

// Mutaciones — todas via service_role (CP es super-admin cross-customer).
// Validaciones de input duras: el slug es el subdomain, no permite cambios
// libres una vez creado (issue #232 si queremos rename con redirect).

export interface CreateCustomerInput {
  slug: string;
  name: string;
  legalName?: string | null;
  rfc?: string | null;
  status?: CustomerStatus;
  tier?: CustomerTier;
  timezone?: string;
  brandColorPrimary?: string | null;
  brandLogoUrl?: string | null;
  monthlyFeeMxn?: number | null;
  perDriverFeeMxn?: number | null;
  contractStartedAt?: string | null;
  contractEndsAt?: string | null;
  notes?: string | null;
}

// slug: lowercase, alfanumérico + guiones, 2-40 chars. Es el subdomain.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new Error('slug inválido (2-40 chars, lowercase a-z, 0-9, guiones; no inicia/termina con guión)');
  }
  if (!input.name.trim()) {
    throw new Error('name requerido');
  }

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from('customers')
    .insert({
      slug,
      name: input.name.trim(),
      legal_name: input.legalName ?? null,
      rfc: input.rfc ?? null,
      status: input.status ?? 'demo',
      tier: input.tier ?? 'starter',
      timezone: input.timezone ?? 'America/Mexico_City',
      brand_color_primary: input.brandColorPrimary ?? '#34c97c',
      brand_logo_url: input.brandLogoUrl ?? null,
      monthly_fee_mxn: input.monthlyFeeMxn ?? null,
      per_driver_fee_mxn: input.perDriverFeeMxn ?? null,
      contract_started_at: input.contractStartedAt ?? null,
      contract_ends_at: input.contractEndsAt ?? null,
      notes: input.notes ?? null,
    })
    .select(CUSTOMER_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Ya existe un customer con slug '${slug}'`);
    }
    throw new Error(`[cp.customers.create] ${error.message}`);
  }
  return toCustomer(data as unknown as CustomerRow);
}

// Update — el slug NO se cambia desde aquí. Cambios libres: status, tier,
// branding, comercial, notas. Cambios de timezone afectan ventanas; OK.
export interface UpdateCustomerInput {
  name?: string;
  legalName?: string | null;
  rfc?: string | null;
  status?: CustomerStatus;
  tier?: CustomerTier;
  timezone?: string;
  brandColorPrimary?: string | null;
  brandLogoUrl?: string | null;
  monthlyFeeMxn?: number | null;
  perDriverFeeMxn?: number | null;
  contractStartedAt?: string | null;
  contractEndsAt?: string | null;
  notes?: string | null;
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
  const update: TableUpdate<'customers'> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('name no puede ser vacío');
    update.name = input.name.trim();
  }
  if (input.legalName !== undefined) update.legal_name = input.legalName;
  if (input.rfc !== undefined) update.rfc = input.rfc;
  if (input.status !== undefined) update.status = input.status;
  if (input.tier !== undefined) update.tier = input.tier;
  if (input.timezone !== undefined) update.timezone = input.timezone;
  if (input.brandColorPrimary !== undefined) update.brand_color_primary = input.brandColorPrimary;
  if (input.brandLogoUrl !== undefined) update.brand_logo_url = input.brandLogoUrl;
  if (input.monthlyFeeMxn !== undefined) update.monthly_fee_mxn = input.monthlyFeeMxn;
  if (input.perDriverFeeMxn !== undefined) update.per_driver_fee_mxn = input.perDriverFeeMxn;
  if (input.contractStartedAt !== undefined) update.contract_started_at = input.contractStartedAt;
  if (input.contractEndsAt !== undefined) update.contract_ends_at = input.contractEndsAt;
  if (input.notes !== undefined) update.notes = input.notes;

  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .update(update)
    .eq('id', id)
    .select(CUSTOMER_COLS)
    .single();

  if (error) throw new Error(`[cp.customers.update] ${error.message}`);
  return toCustomer(data as unknown as CustomerRow);
}

// Agregación global de customers para el overview.
export interface CustomersAggregate {
  total: number;
  byStatus: Record<CustomerStatus, number>;
  byTier: Record<CustomerTier, number>;
  totalMonthlyFee: number;
}

export async function getCustomersAggregate(): Promise<CustomersAggregate> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select('status, tier, monthly_fee_mxn');
  if (error) throw new Error(`[cp.customers.aggregate] ${error.message}`);

  const byStatus: Record<CustomerStatus, number> = {
    active: 0, paused: 0, churned: 0, demo: 0,
  };
  const byTier: Record<CustomerTier, number> = {
    starter: 0, pro: 0, enterprise: 0,
  };
  let totalMonthlyFee = 0;

  for (const r of (data ?? []) as Array<{
    status: CustomerStatus;
    tier: CustomerTier;
    monthly_fee_mxn: number | null;
  }>) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    if (r.status === 'active' && r.monthly_fee_mxn !== null) {
      totalMonthlyFee += Number(r.monthly_fee_mxn);
    }
  }

  return {
    total: (data ?? []).length,
    byStatus,
    byTier,
    totalMonthlyFee,
  };
}
