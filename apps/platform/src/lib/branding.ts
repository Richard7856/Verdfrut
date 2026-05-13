// ADR-089 / Fase A4.1 — Branding customizable per-customer.
//
// Lee `customer.brand_color_primary` + `customer.brand_logo_url` del
// customer del user logueado y los expone para inyección en el layout.
//
// Default fallback (verdfrut o cuando no hay sesión): #34c97c + null logo
// — equivalente al verde TripDrive del sistema, cero cambio visual.

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

// Hex 6-char validation — defensa contra colores malformados que romperían CSS.
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export async function getCurrentCustomerBranding(): Promise<CustomerBranding> {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return DEFAULT_BRANDING;

    // Join user_profiles → customers en una sola query.
    // La policy `customers_select` solo permite leer el propio customer.
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
    // Si algo falla (RLS, network), fallback al default — branding nunca
    // debe romper el layout principal.
    return DEFAULT_BRANDING;
  }
}

/**
 * Inyecta CSS vars del customer en el `<style>` que el layout renderiza.
 * Las vars son nuevas (`--customer-*`) — no sobrescriben el theme TripDrive.
 * Componentes en A4.2+ las usan opt-in.
 */
export function brandingCss(branding: CustomerBranding): string {
  return `:root{--customer-brand-primary:${branding.colorPrimary};}`;
}
