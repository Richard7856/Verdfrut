'use server';

// Server actions para customers — Fase A2.3.
// CP admin tiene super-permisos cross-customer; la auth viene del middleware
// con cookie HMAC (no Supabase Auth para V1). Por eso no validamos JWT acá.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createCustomer,
  updateCustomer,
  getCustomerById,
  type CustomerStatus,
  type CustomerTier,
} from '@/lib/queries/customers';
import { TOGGLEABLE_FEATURE_KEYS, type PlanFeatures } from '@tripdrive/plans';

interface ActionResult {
  ok: boolean;
  error?: string;
  field?: string;
}

const VALID_STATUS: ReadonlyArray<CustomerStatus> = ['active', 'demo', 'paused', 'churned'];
const VALID_TIER: ReadonlyArray<CustomerTier> = ['starter', 'pro', 'enterprise'];

function parseStatus(raw: FormDataEntryValue | null): CustomerStatus {
  const v = (raw ?? '').toString();
  return (VALID_STATUS as ReadonlyArray<string>).includes(v) ? (v as CustomerStatus) : 'demo';
}
function parseTier(raw: FormDataEntryValue | null): CustomerTier {
  const v = (raw ?? '').toString();
  return (VALID_TIER as ReadonlyArray<string>).includes(v) ? (v as CustomerTier) : 'starter';
}
function strOrNull(raw: FormDataEntryValue | null): string | null {
  const v = (raw ?? '').toString().trim();
  return v.length === 0 ? null : v;
}
function intOrNull(raw: FormDataEntryValue | null): number | null {
  const v = (raw ?? '').toString().trim();
  if (v.length === 0) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}
function dateOrNull(raw: FormDataEntryValue | null): string | null {
  const v = (raw ?? '').toString().trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  return v;
}

/**
 * Lee el form 3-estado por feature: 'default' (no override) | 'on' | 'off'.
 * Sólo escribe la key al objeto si el admin explícitamente puso on/off.
 *
 * El name del input es `override_<key>`. Los radios deben tener los tres
 * values: '', 'true', 'false'.
 */
function parseFeatureOverrides(formData: FormData): Partial<PlanFeatures> {
  const out: Partial<PlanFeatures> = {};
  for (const key of TOGGLEABLE_FEATURE_KEYS) {
    const raw = formData.get(`override_${String(key)}`)?.toString() ?? '';
    if (raw === 'true') (out as Record<string, unknown>)[key] = true;
    else if (raw === 'false') (out as Record<string, unknown>)[key] = false;
    // default vacío → no agrega la key → hereda del tier.
  }
  return out;
}

export async function createCustomerAction(formData: FormData): Promise<ActionResult> {
  try {
    const slug = (formData.get('slug') ?? '').toString().trim().toLowerCase();
    const name = (formData.get('name') ?? '').toString().trim();
    if (!slug) return { ok: false, error: 'Slug requerido', field: 'slug' };
    if (!name) return { ok: false, error: 'Nombre requerido', field: 'name' };

    const customer = await createCustomer({
      slug,
      name,
      legalName: strOrNull(formData.get('legalName')),
      rfc: strOrNull(formData.get('rfc')),
      status: parseStatus(formData.get('status')),
      tier: parseTier(formData.get('tier')),
      timezone: (formData.get('timezone') ?? 'America/Mexico_City').toString(),
      brandColorPrimary: strOrNull(formData.get('brandColorPrimary')),
      brandLogoUrl: strOrNull(formData.get('brandLogoUrl')),
      monthlyFeeMxn: intOrNull(formData.get('monthlyFeeMxn')),
      perDriverFeeMxn: intOrNull(formData.get('perDriverFeeMxn')),
      contractStartedAt: dateOrNull(formData.get('contractStartedAt')),
      contractEndsAt: dateOrNull(formData.get('contractEndsAt')),
      notes: strOrNull(formData.get('notes')),
      featureOverrides: parseFeatureOverrides(formData),
    });

    revalidatePath('/customers');
    redirect(`/customers/${customer.slug}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

export async function updateCustomerAction(
  customerId: string,
  formData: FormData,
): Promise<ActionResult> {
  try {
    const existing = await getCustomerById(customerId);
    if (!existing) return { ok: false, error: 'Customer no encontrado' };

    const updated = await updateCustomer(customerId, {
      name: (formData.get('name') ?? '').toString().trim() || undefined,
      legalName: strOrNull(formData.get('legalName')),
      rfc: strOrNull(formData.get('rfc')),
      status: parseStatus(formData.get('status')),
      tier: parseTier(formData.get('tier')),
      timezone: (formData.get('timezone') ?? existing.timezone).toString(),
      brandColorPrimary: strOrNull(formData.get('brandColorPrimary')),
      brandLogoUrl: strOrNull(formData.get('brandLogoUrl')),
      monthlyFeeMxn: intOrNull(formData.get('monthlyFeeMxn')),
      perDriverFeeMxn: intOrNull(formData.get('perDriverFeeMxn')),
      contractStartedAt: dateOrNull(formData.get('contractStartedAt')),
      contractEndsAt: dateOrNull(formData.get('contractEndsAt')),
      notes: strOrNull(formData.get('notes')),
      featureOverrides: parseFeatureOverrides(formData),
    });

    revalidatePath('/customers');
    revalidatePath(`/customers/${updated.slug}`);
    redirect(`/customers/${updated.slug}`);
  } catch (err) {
    if (err instanceof Error && err.message === 'NEXT_REDIRECT') throw err;
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}
