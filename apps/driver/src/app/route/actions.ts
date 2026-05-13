'use server';

// Server actions de la pantalla de paradas del chofer.
// ADR-035: el chofer puede reordenar paradas pendientes de su ruta cuando
// la ruta está en PUBLISHED/IN_PROGRESS (porque conoce el terreno mejor).
//
// Auth: requireDriverProfile() asegura que solo el chofer logueado lo invoca.
// RLS de stops permite UPDATE al chofer dueño de la ruta (stops_update policy).
// El bump de routes.version + audit insert se hace via RPC
// `bump_route_version_by_driver` SECURITY DEFINER (ADR-085 / migration 036)
// para no exponer service_role en este flow — cierra AV-#2 / issue #63.

import 'server-only';
import { revalidatePath } from 'next/cache';
import { createServerClient } from '@tripdrive/supabase/server';
import { todayInZone } from '@tripdrive/utils';
import { logger } from '@tripdrive/observability';
import { requireDriverProfile } from '@/lib/auth';

interface ActionResult {
  ok: boolean;
  error?: string;
}

const TENANT_TZ = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

// P0-3: validación defensiva de UUIDs en arrays que vienen del cliente.
// Supabase REST escapa parámetros, pero queremos rechazar inputs malformados
// antes de pegarle a la BD — error temprano + log claro.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertAllUuids(ids: string[], label: string): void {
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new Error(`${label} contiene un id inválido: ${String(id).slice(0, 60)}`);
    }
  }
}

/**
 * Reordena las paradas PENDIENTES de la ruta activa del chofer.
 *
 * Validaciones:
 *  - El chofer debe tener una ruta hoy en estado PUBLISHED o IN_PROGRESS.
 *  - `orderedPendingStopIds` debe contener EXACTAMENTE los IDs de las paradas
 *    pending de esa ruta (no más, no menos, no IDs ajenos).
 *  - Las paradas no-pending (completed/arrived/skipped) mantienen su sequence
 *    histórica — el chofer NO las puede mover.
 *
 * Efectos:
 *  - UPDATE stops.sequence con sesión del chofer (RLS lo permite).
 *  - Bump routes.version + insert route_versions con razón "Chofer reorden"
 *    (vía service_role porque routes_update es solo admin).
 *  - revalidatePath de /route para que la lista refresque.
 */
export async function reorderStopsByDriverAction(
  orderedPendingStopIds: string[],
): Promise<ActionResult> {
  try {
    const profile = await requireDriverProfile();
    const supabase = await createServerClient();

    if (!Array.isArray(orderedPendingStopIds) || orderedPendingStopIds.length === 0) {
      return { ok: false, error: 'No se recibieron paradas para reordenar.' };
    }
    try {
      assertAllUuids(orderedPendingStopIds, 'orderedPendingStopIds');
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'IDs inválidos' };
    }

    // 1. driver_id del chofer
    const { data: driverRow, error: drvErr } = await supabase
      .from('drivers')
      .select('id')
      .eq('user_id', profile.id)
      .maybeSingle();
    if (drvErr || !driverRow) {
      return { ok: false, error: 'No se encontró tu registro de chofer.' };
    }

    // 2. Ruta activa del día (PUBLISHED o IN_PROGRESS)
    const today = todayInZone(TENANT_TZ);
    const { data: route, error: rtErr } = await supabase
      .from('routes')
      .select('id, version, status')
      .eq('driver_id', driverRow.id)
      .eq('date', today)
      .in('status', ['PUBLISHED', 'IN_PROGRESS'])
      .maybeSingle();
    if (rtErr || !route) {
      return { ok: false, error: 'No tienes una ruta activa hoy para reordenar.' };
    }

    // 3. Stops actuales (RLS las filtra por ruta visible al chofer)
    const { data: currentStops, error: stErr } = await supabase
      .from('stops')
      .select('id, status, sequence')
      .eq('route_id', route.id);
    if (stErr || !currentStops) {
      return { ok: false, error: 'No se pudieron leer las paradas.' };
    }

    const pending = currentStops.filter((s) => s.status === 'pending');
    const nonPending = [...currentStops]
      .filter((s) => s.status !== 'pending')
      .sort((a, b) => a.sequence - b.sequence);
    const pendingIds = new Set(pending.map((s) => s.id));

    // 4. Validar que orderedPendingStopIds coincide exactamente con pending
    if (orderedPendingStopIds.length !== pending.length) {
      return {
        ok: false,
        error: `Solo se pueden reordenar paradas pendientes (esperadas ${pending.length}, recibidas ${orderedPendingStopIds.length}).`,
      };
    }
    const seen = new Set<string>();
    for (const id of orderedPendingStopIds) {
      if (!pendingIds.has(id)) {
        return { ok: false, error: 'Una de las paradas no es pendiente o no es tuya.' };
      }
      if (seen.has(id)) {
        return { ok: false, error: 'Hay paradas duplicadas en el orden enviado.' };
      }
      seen.add(id);
    }

    // 5. Construir orden final + UPDATE secuencial
    // Histórico (no-pending) primero, en su orden de sequence original.
    // Luego pending en el orden nuevo. Numeración 1..N.
    const finalOrder = [...nonPending.map((s) => s.id), ...orderedPendingStopIds];

    // UPDATE en 2 pasos para evitar conflictos con UNIQUE(route_id, sequence) si existiera.
    // Paso A: poner secuencias temporales negativas. Paso B: secuencias finales.
    // (No hay UNIQUE actual pero defensivo por si se agrega.)
    for (let i = 0; i < finalOrder.length; i++) {
      const stopId = finalOrder[i];
      if (!stopId) continue; // Defensive — finalOrder se construye dense, no debería pasar.
      const { error: tmpErr } = await supabase
        .from('stops')
        .update({ sequence: -1 - i })
        .eq('id', stopId);
      if (tmpErr) {
        return { ok: false, error: `Error preparando reorden: ${tmpErr.message}` };
      }
    }
    for (let i = 0; i < finalOrder.length; i++) {
      const stopId = finalOrder[i];
      if (!stopId) continue;
      const { error: finalErr } = await supabase
        .from('stops')
        .update({ sequence: i + 1 })
        .eq('id', stopId);
      if (finalErr) {
        return { ok: false, error: `Error guardando reorden: ${finalErr.message}` };
      }
    }

    // 6. Audit: RPC SECURITY DEFINER hace bump de version + insert
    // route_versions atómico, validando ownership con auth.uid() (ADR-085).
    // Audit failure NO debe revertir el reorden — las stops ya están en
    // orden nuevo; el bump es metadata observacional.
    const { error: bumpErr } = await supabase.rpc('bump_route_version_by_driver', {
      p_route_id: route.id,
      p_reason: 'Chofer reordenó paradas pendientes',
    });
    if (bumpErr) {
      await logger.warn('reorderStopsByDriver: bump RPC falló (reorden persistió igual)', {
        err: bumpErr,
        routeId: route.id,
      });
    }

    revalidatePath('/route');
    revalidatePath('/route/navigate');
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido al reordenar.',
    };
  }
}
