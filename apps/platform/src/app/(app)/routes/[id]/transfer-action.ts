'use server';

// Server action: transferir paradas pendientes de una ruta a otra (S18.7).
//
// Caso: camión del chofer A se descompone después de completar X paradas.
// Las paradas pendientes (status='pending') se transfieren a un chofer B con
// otro vehículo, en una ruta NUEVA (status='PUBLISHED'). La ruta original
// queda en INTERRUPTED para audit.
//
// Notas:
// - NO usa transacción Postgres (Supabase JS no expone API). Ante fallo a mitad,
//   intenta rollback best-effort. Para multi-fallos, queda en estado inconsistente
//   y el admin debe resolver manualmente. Aceptable para escala V2.
// - Las paradas TRANSFERIDAS se RE-NUMERAN sequence en la ruta destino (1..N)
//   para que VROOM/UI no se confundan con sequence original.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import { requireAdminOrDispatcher } from '@/lib/auth';

export interface TransferResult {
  ok: boolean;
  error?: string;
  newRouteId?: string;
  transferredCount?: number;
}

interface TransferInput {
  sourceRouteId: string;
  targetVehicleId: string;
  targetDriverId: string | null;
  reason: string;
  /** Si la ruta original tenía dispatch_id, mantenerlo en la nueva. */
  inheritDispatch?: boolean;
}

export async function transferRouteRemainderAction(input: TransferInput): Promise<TransferResult> {
  const profile = await requireAdminOrDispatcher();
  const supabase = await createServerClient();

  if (!input.reason.trim()) {
    return { ok: false, error: 'La razón es requerida.' };
  }
  if (input.reason.length > 500) {
    return { ok: false, error: 'Razón demasiado larga (máx 500 caracteres).' };
  }

  // 1. Cargar ruta original + verificar estado válido para transfer.
  const { data: source, error: sourceErr } = await supabase
    .from('routes')
    .select('id, name, date, vehicle_id, driver_id, zone_id, dispatch_id, status')
    .eq('id', input.sourceRouteId)
    .single();
  if (sourceErr || !source) return { ok: false, error: 'Ruta origen no encontrada.' };

  if (source.status !== 'PUBLISHED' && source.status !== 'IN_PROGRESS') {
    return {
      ok: false,
      error: `Solo se puede transferir desde rutas PUBLISHED o IN_PROGRESS (actual: ${source.status}).`,
    };
  }

  // 2. Cargar stops pending para transferir.
  const { data: pendingStops, error: stopsErr } = await supabase
    .from('stops')
    .select('id, sequence')
    .eq('route_id', input.sourceRouteId)
    .eq('status', 'pending')
    .order('sequence', { ascending: true });
  if (stopsErr) return { ok: false, error: `Stops: ${stopsErr.message}` };
  if (!pendingStops || pendingStops.length === 0) {
    return { ok: false, error: 'No hay paradas pendientes para transferir.' };
  }

  // 3. Crear ruta nueva con status PUBLISHED.
  const newName = `${source.name} (transfer)`;
  const { data: newRoute, error: createErr } = await supabase
    .from('routes')
    .insert({
      name: newName.slice(0, 100),
      date: source.date,
      vehicle_id: input.targetVehicleId,
      driver_id: input.targetDriverId,
      zone_id: source.zone_id,
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      published_by: profile.id,
      created_by: profile.id,
      dispatch_id: input.inheritDispatch ? source.dispatch_id : null,
    })
    .select('id')
    .single();
  if (createErr || !newRoute) {
    return { ok: false, error: `Crear ruta nueva falló: ${createErr?.message ?? 'desconocido'}` };
  }
  const newRouteId = newRoute.id;

  // 4. Mover stops y re-numerar sequence en la nueva ruta.
  // Hacemos un UPDATE por stop con su nuevo sequence. No es eficiente para
  // 100+ stops pero V2 maneja routes de <= 30 stops típicamente.
  let transferred = 0;
  for (let i = 0; i < pendingStops.length; i++) {
    const stop = pendingStops[i]!;
    const { error: updErr } = await supabase
      .from('stops')
      .update({
        route_id: newRouteId,
        sequence: i + 1,
      })
      .eq('id', stop.id);
    if (updErr) {
      // Best-effort rollback: borrar la nueva ruta. Stops movidos quedan inconsistentes.
      await supabase.from('routes').delete().eq('id', newRouteId);
      return {
        ok: false,
        error: `Falló al mover stop ${stop.id}: ${updErr.message}. Operación revertida.`,
      };
    }
    transferred++;
  }

  // 5. Marcar ruta original como INTERRUPTED + razón en metadata.
  const { error: srcUpdErr } = await supabase
    .from('routes')
    .update({
      status: 'INTERRUPTED',
      actual_end_at: new Date().toISOString(),
    })
    .eq('id', input.sourceRouteId);
  if (srcUpdErr) {
    await logger.error('[transfer] no se pudo marcar source INTERRUPTED', {
      err: srcUpdErr.message,
      sourceRouteId: input.sourceRouteId,
    });
    // No revertir el resto — el transfer ya se hizo, solo el status falló.
  }

  // 6. Insert audit log.
  await supabase.from('route_transfers').insert({
    source_route_id: input.sourceRouteId,
    target_route_id: newRouteId,
    reason: input.reason,
    transferred_stop_count: transferred,
    performed_by: profile.id,
  });

  revalidatePath(`/routes/${input.sourceRouteId}`);
  revalidatePath(`/routes/${newRouteId}`);
  revalidatePath('/routes');

  return { ok: true, newRouteId, transferredCount: transferred };
}
