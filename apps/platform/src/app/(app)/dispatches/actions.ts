'use server';

// Server Actions de tiros (dispatches). ADR-024 + ADR-025.
// Operaciones: crear, renombrar, eliminar, asignar/desasignar rutas, mover paradas.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@verdfrut/supabase/server';
import { requireRole } from '@/lib/auth';
import { moveStopToAnotherRoute } from '@/lib/queries/stops';
import {
  runAction,
  requireUuid,
  ValidationError,
  type ActionResult,
} from '@/lib/validation';

const MAX_NAME_LEN = 80;
const MAX_NOTES_LEN = 500;

interface CreateDispatchInput {
  name: string;
  date: string;       // YYYY-MM-DD
  zoneId: string;
  notes?: string | null;
}

export interface CreateDispatchResult extends ActionResult {
  id?: string;
}

/**
 * Crea un tiro vacío. El dispatcher después agrega rutas a este tiro.
 * Devuelve {ok, id} en éxito; {ok:false, error} si falla.
 */
export async function createDispatchAction(
  input: CreateDispatchInput,
): Promise<CreateDispatchResult> {
  try {
    const profile = await requireRole('admin', 'dispatcher');
    const name = (input.name ?? '').trim();
    if (name.length < 2) throw new ValidationError('name', 'El nombre debe tener al menos 2 caracteres.');
    if (name.length > MAX_NAME_LEN) throw new ValidationError('name', `Nombre máx ${MAX_NAME_LEN}.`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new ValidationError('date', 'Formato YYYY-MM-DD requerido.');
    }
    requireUuid('zoneId', input.zoneId);
    const notes = (input.notes ?? '').trim();
    if (notes.length > MAX_NOTES_LEN) {
      throw new ValidationError('notes', `Notas máx ${MAX_NOTES_LEN}.`);
    }

    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from('dispatches')
      .insert({
        name,
        date: input.date,
        zone_id: input.zoneId,
        notes: notes || null,
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (error) {
      if (error.code === '23505') {
        return { ok: false, error: `Ya existe un tiro "${name}" para esa zona y fecha.` };
      }
      return { ok: false, error: error.message };
    }
    revalidatePath('/dispatches');
    return { ok: true, id: data.id as string };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message, field: err.field };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/**
 * Asocia una ruta existente a un tiro.
 * Validaciones: misma zona, misma fecha — un tiro no puede mezclar zonas/fechas.
 */
export async function assignRouteToDispatchAction(
  dispatchId: string,
  routeId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    requireUuid('dispatchId', dispatchId);
    requireUuid('routeId', routeId);

    const supabase = await createServerClient();
    const { data: pair, error: rErr } = await supabase
      .from('dispatches')
      .select('zone_id, date')
      .eq('id', dispatchId)
      .maybeSingle();
    if (rErr || !pair) throw new ValidationError('dispatchId', 'Tiro no encontrado.');

    const { data: route, error: routeErr } = await supabase
      .from('routes')
      .select('zone_id, date')
      .eq('id', routeId)
      .maybeSingle();
    if (routeErr || !route) throw new ValidationError('routeId', 'Ruta no encontrada.');

    if (route.zone_id !== pair.zone_id || route.date !== pair.date) {
      throw new ValidationError(
        'routeId',
        'La ruta debe ser de la misma zona y fecha que el tiro.',
      );
    }

    const { error } = await supabase
      .from('routes')
      .update({ dispatch_id: dispatchId })
      .eq('id', routeId);
    if (error) throw new Error(error.message);

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${dispatchId}`);
    revalidatePath('/routes');
  });
}

/**
 * Quita una ruta de un tiro (sin borrarla — queda huérfana).
 */
export async function unassignRouteFromDispatchAction(
  routeId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    requireUuid('routeId', routeId);
    const supabase = await createServerClient();
    const { data: route } = await supabase
      .from('routes')
      .select('dispatch_id')
      .eq('id', routeId)
      .maybeSingle();
    const oldDispatchId = (route?.dispatch_id as string | null) ?? null;

    const { error } = await supabase
      .from('routes')
      .update({ dispatch_id: null })
      .eq('id', routeId);
    if (error) throw new Error(error.message);

    revalidatePath('/dispatches');
    if (oldDispatchId) revalidatePath(`/dispatches/${oldDispatchId}`);
    revalidatePath('/routes');
  });
}

/**
 * Edita nombre / notas del tiro.
 */
export async function updateDispatchAction(
  dispatchId: string,
  patch: { name?: string; notes?: string | null },
): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    requireUuid('dispatchId', dispatchId);

    const update: { name?: string; notes?: string | null; updated_at?: string } = {};
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (name.length < 2 || name.length > MAX_NAME_LEN) {
        throw new ValidationError('name', `Nombre fuera de rango (2-${MAX_NAME_LEN}).`);
      }
      update.name = name;
    }
    if (patch.notes !== undefined) {
      const notes = (patch.notes ?? '').trim();
      if (notes.length > MAX_NOTES_LEN) {
        throw new ValidationError('notes', `Notas máx ${MAX_NOTES_LEN}.`);
      }
      update.notes = notes || null;
    }
    if (Object.keys(update).length === 0) return;
    update.updated_at = new Date().toISOString();

    const supabase = await createServerClient();
    const { error } = await supabase.from('dispatches').update(update).eq('id', dispatchId);
    if (error) throw new Error(error.message);

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${dispatchId}`);
  });
}

/**
 * Mueve una parada de su ruta actual a otra ruta del mismo tiro. ADR-025.
 * Solo funciona si ambas rutas están editable (DRAFT/OPTIMIZED/APPROVED) y la
 * parada está pending. Re-numera sequences en origen y destino.
 */
export async function moveStopToAnotherRouteAction(
  stopId: string,
  targetRouteId: string,
  dispatchId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    requireUuid('stopId', stopId);
    requireUuid('targetRouteId', targetRouteId);
    requireUuid('dispatchId', dispatchId);
    await moveStopToAnotherRoute(stopId, targetRouteId);
    revalidatePath(`/dispatches/${dispatchId}`);
  });
}

/**
 * Elimina un tiro. Las rutas hijas quedan huérfanas (FK ON DELETE SET NULL).
 */
export async function deleteDispatchAction(dispatchId: string): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    requireUuid('dispatchId', dispatchId);
    const supabase = await createServerClient();
    const { error } = await supabase.from('dispatches').delete().eq('id', dispatchId);
    if (error) throw new Error(error.message);
    revalidatePath('/dispatches');
    revalidatePath('/routes');
  });
}
