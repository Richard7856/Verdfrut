'use server';

// Server action para actualizar settings del flow per-customer.
// Persiste en `customers.flow_engine_overrides` (JSONB ya existe post mig 037).
//
// HOY: solo persiste — el código del native NO lee dinámico todavía
// (los radios siguen hardcoded en apps/driver-native/src/lib/actions/arrive.ts).
// El próximo rebuild EAS leerá el config desde aquí.

import { revalidatePath } from 'next/cache';
import { createServerClient, createServiceRoleClient } from '@tripdrive/supabase/server';
import { requireRole } from '@/lib/auth';

interface UpdateFlowSettingsInput {
  customerSlug: string;
  arrivalRadiusEntregaMeters: number;
  arrivalRadiusTiendaCerradaMeters: number;
  arrivalRadiusBasculaMeters: number;
}

interface UpdateResult {
  ok: boolean;
  error?: string;
}

export async function updateFlowSettingsAction(
  input: UpdateFlowSettingsInput,
): Promise<UpdateResult> {
  try {
    await requireRole('admin', 'dispatcher');

    // Validación de rangos sanos (10m mín, 5000m máx).
    const validate = (v: number, label: string): string | null => {
      if (!Number.isFinite(v) || v < 10 || v > 5000) {
        return `${label} debe estar entre 10 y 5000 metros.`;
      }
      return null;
    };
    const err =
      validate(input.arrivalRadiusEntregaMeters, 'Radio entrega') ??
      validate(input.arrivalRadiusTiendaCerradaMeters, 'Radio tienda cerrada') ??
      validate(input.arrivalRadiusBasculaMeters, 'Radio báscula');
    if (err) return { ok: false, error: err };

    // El shell tiene customer.id como slug visible (ej. "neto-real").
    // En BD el customer real se identifica por `slug` único — usamos eso para
    // resolver y persistir.
    const admin = createServiceRoleClient();
    const supabase = await createServerClient();

    // Para el shell actual, todos los stores son del customer único 'verdfrut'.
    // El slug del shell ("neto-real") es un alias visual; el override real va
    // al customer cuyo slug coincida con `customerSlug` o, si no existe, al
    // customer activo único.
    let targetSlug = input.customerSlug;
    const { data: customerBySlug } = await supabase
      .from('customers')
      .select('id, slug, flow_engine_overrides')
      .eq('slug', targetSlug)
      .maybeSingle();

    let targetCustomer = customerBySlug as {
      id: string;
      slug: string;
      flow_engine_overrides: Record<string, unknown> | null;
    } | null;

    if (!targetCustomer) {
      // Fallback: customer activo (verdfrut hoy).
      const { data: fallback } = await supabase
        .from('customers')
        .select('id, slug, flow_engine_overrides')
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      if (!fallback) {
        return { ok: false, error: 'No hay customer activo para persistir.' };
      }
      targetCustomer = fallback as {
        id: string;
        slug: string;
        flow_engine_overrides: Record<string, unknown> | null;
      };
      targetSlug = targetCustomer.slug;
    }

    const newOverrides = {
      ...(targetCustomer.flow_engine_overrides ?? {}),
      arrival_radius_meters: {
        entrega: input.arrivalRadiusEntregaMeters,
        tienda_cerrada: input.arrivalRadiusTiendaCerradaMeters,
        bascula: input.arrivalRadiusBasculaMeters,
      },
    };

    const { error: updErr } = await admin
      .from('customers')
      .update({ flow_engine_overrides: newOverrides as never })
      .eq('id', targetCustomer.id);

    if (updErr) {
      return { ok: false, error: `Error al guardar: ${updErr.message}` };
    }

    revalidatePath(`/customers/${input.customerSlug}/flow`);
    revalidatePath(`/customers/${input.customerSlug}`);
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido.',
    };
  }
}
