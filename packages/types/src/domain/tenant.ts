// Un Tenant representa un cliente de VerdFrut (Neto, OXXO, distribuidora X).
// Cada tenant tiene su propio proyecto Supabase.
// Esta info vive en el control plane, no en el proyecto del tenant.

export type TenantStatus = 'active' | 'suspended' | 'onboarding' | 'archived';

export type TenantPlan = 'starter' | 'pro' | 'enterprise';

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  plan: TenantPlan;
  timezone: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantRegistryEntry {
  slug: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceKey?: string;
  status: TenantStatus;
  plan: TenantPlan;
  timezone: string;
}
