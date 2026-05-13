// ADR-089 / Fase A4.1 — Branding customizable per-customer en driver PWA.
// Mismo helper que `apps/platform/src/lib/branding.ts` (duplicación deliberada
// V1; mover a `@tripdrive/branding` cuando entre el 3er consumidor).

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';

export interface CustomerBranding {
  customerId: string | null;
  customerSlug: string | null;
  customerName: string | null;
  colorPrimary: string;
  logoUrl: string | null;
}

const DEFAULT_BRANDING: CustomerBranding = {
  customerId: null,
  customerSlug: null,
  customerName: null,
  colorPrimary: '#34c97c',
  logoUrl: null,
};

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function getCurrentCustomerBranding(): Promise<CustomerBranding> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return DEFAULT_BRANDING;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('customer_id, customers!inner(id, slug, name, brand_color_primary, brand_logo_url)')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) return DEFAULT_BRANDING;

    const customer = (data as unknown as {
      customers: {
        id: string;
        slug: string;
        name: string;
        brand_color_primary: string | null;
        brand_logo_url: string | null;
      } | null;
    }).customers;

    if (!customer) return DEFAULT_BRANDING;

    const color = customer.brand_color_primary && HEX_RE.test(customer.brand_color_primary)
      ? customer.brand_color_primary
      : DEFAULT_BRANDING.colorPrimary;

    return {
      customerId: customer.id,
      customerSlug: customer.slug,
      customerName: customer.name,
      colorPrimary: color,
      logoUrl: customer.brand_logo_url,
    };
  } catch {
    return DEFAULT_BRANDING;
  }
}

export function brandingCss(branding: CustomerBranding): string {
  return `:root{--customer-brand-primary:${branding.colorPrimary};}`;
}
