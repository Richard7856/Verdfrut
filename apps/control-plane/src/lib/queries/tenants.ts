// Queries de control_plane.tenants — Sprint 17.
// Server-only. Usa service_role (vía cpClient) porque las RLS del schema
// bloquean anon/authenticated por diseño.

import 'server-only';
import { cpClient } from '@/lib/cp-client';

export type TenantStatus = 'provisioning' | 'active' | 'suspended' | 'archived';
export type TenantPlan = 'starter' | 'pro' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  supabaseProjectRef: string | null;
  supabaseUrl: string | null;
  timezone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  contractedAt: string | null;
  monthlyFee: number | null;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  cachedZoneCount: number;
  cachedDriverCount: number;
  cachedActiveRouteCount: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface TenantRow {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  supabase_project_ref: string | null;
  supabase_url: string | null;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  contracted_at: string | null;
  monthly_fee: number | null;
  last_sync_at: string | null;
  last_sync_error: string | null;
  cached_zone_count: number;
  cached_driver_count: number;
  cached_active_route_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

const TENANT_COLS = `
  id, slug, name, status, plan, supabase_project_ref, supabase_url, timezone,
  contact_email, contact_phone, contracted_at, monthly_fee,
  last_sync_at, last_sync_error,
  cached_zone_count, cached_driver_count, cached_active_route_count,
  notes, created_at, updated_at
`;

function toTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    plan: row.plan,
    supabaseProjectRef: row.supabase_project_ref,
    supabaseUrl: row.supabase_url,
    timezone: row.timezone,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    contractedAt: row.contracted_at,
    monthlyFee: row.monthly_fee !== null ? Number(row.monthly_fee) : null,
    lastSyncAt: row.last_sync_at,
    lastSyncError: row.last_sync_error,
    cachedZoneCount: row.cached_zone_count,
    cachedDriverCount: row.cached_driver_count,
    cachedActiveRouteCount: row.cached_active_route_count,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listTenants(opts?: { status?: TenantStatus }): Promise<Tenant[]> {
  let q = cpClient().from('tenants').select(TENANT_COLS).order('name');
  if (opts?.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) throw new Error(`[cp.tenants.list] ${error.message}`);
  return (data ?? []).map((row) => toTenant(row as unknown as TenantRow));
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const { data, error } = await cpClient()
    .from('tenants')
    .select(TENANT_COLS)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`[cp.tenants.getBySlug] ${error.message}`);
  return data ? toTenant(data as unknown as TenantRow) : null;
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const { data, error } = await cpClient()
    .from('tenants')
    .select(TENANT_COLS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`[cp.tenants.getById] ${error.message}`);
  return data ? toTenant(data as unknown as TenantRow) : null;
}

/**
 * Suma de KPIs cacheados a través de todos los tenants activos.
 * Útil para el overview del CP — vista global del SaaS.
 */
export interface TenantsAggregate {
  total: number;
  byStatus: Record<TenantStatus, number>;
  totalZones: number;
  totalDrivers: number;
  totalActiveRoutes: number;
  totalMonthlyFee: number;
}

export async function getTenantsAggregate(): Promise<TenantsAggregate> {
  const { data, error } = await cpClient()
    .from('tenants')
    .select(
      'status, monthly_fee, cached_zone_count, cached_driver_count, cached_active_route_count',
    );
  if (error) throw new Error(`[cp.tenants.aggregate] ${error.message}`);

  const rows = data ?? [];
  const byStatus: Record<TenantStatus, number> = {
    provisioning: 0,
    active: 0,
    suspended: 0,
    archived: 0,
  };
  let totalZones = 0;
  let totalDrivers = 0;
  let totalActiveRoutes = 0;
  let totalMonthlyFee = 0;

  for (const r of rows as Array<{
    status: TenantStatus;
    monthly_fee: number | null;
    cached_zone_count: number;
    cached_driver_count: number;
    cached_active_route_count: number;
  }>) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.status === 'active') {
      totalZones += r.cached_zone_count ?? 0;
      totalDrivers += r.cached_driver_count ?? 0;
      totalActiveRoutes += r.cached_active_route_count ?? 0;
      totalMonthlyFee += r.monthly_fee !== null ? Number(r.monthly_fee) : 0;
    }
  }

  return {
    total: rows.length,
    byStatus,
    totalZones,
    totalDrivers,
    totalActiveRoutes,
    totalMonthlyFee,
  };
}
