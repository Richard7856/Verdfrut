'use server';

// Server Actions de tiros (dispatches). ADR-024 + ADR-025.
// Operaciones: crear, renombrar, eliminar, asignar/desasignar rutas, mover paradas.

import { revalidatePath } from 'next/cache';
import { createServerClient } from '@verdfrut/supabase/server';
import { requireRole } from '@/lib/auth';
import { moveStopToAnotherRoute, deleteStopsForRoute } from '@/lib/queries/stops';
import { cancelRoute } from '@/lib/queries/routes';
import { listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoute } from '@/lib/queries/stops';
import { createAndOptimizeRoute, type CreateAndOptimizeResult } from '../routes/actions';
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

/**
 * ADR-046: habilita el enlace público read-only del tiro. Genera token UUID
 * y devuelve el path /share/dispatch/{token} para que el cliente arme la URL
 * completa con su window.location.origin.
 */
export interface ShareLinkResult extends ActionResult {
  token?: string;
  path?: string;
}

export async function enableDispatchSharingAction(
  dispatchId: string,
): Promise<ShareLinkResult> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    const { enableDispatchSharing } = await import('@/lib/queries/dispatches');
    const token = await enableDispatchSharing(id);
    revalidatePath(`/dispatches/${id}`);
    return { ok: true, token, path: `/share/dispatch/${token}` };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

export async function disableDispatchSharingAction(
  dispatchId: string,
): Promise<ActionResult> {
  return runAction(async () => {
    await requireRole('admin', 'dispatcher');
    const id = requireUuid('dispatchId', dispatchId);
    const { disableDispatchSharing } = await import('@/lib/queries/dispatches');
    await disableDispatchSharing(id);
    revalidatePath(`/dispatches/${id}`);
  });
}

// ---------------------------------------------------------------------------
// ADR-048: agregar/quitar camionetas dentro de un tiro y re-rutear todo.
// ---------------------------------------------------------------------------
// El dispatcher trabaja al nivel del TIRO, no de rutas individuales. Cuando
// decide "quiero ver cómo queda con otra camioneta", esperaba que el sistema:
//   1. Tomara las paradas que ya están en el tiro (de todas las rutas vivas).
//   2. Llamara al optimizer con la nueva lista de vehículos.
//   3. Reemplazara las rutas pre-publicación con el split nuevo.
//
// Este flujo SOLO opera sobre rutas pre-publicación (DRAFT/OPTIMIZED/APPROVED).
// Si alguna ruta ya está PUBLISHED+ se aborta — el chofer ya recibió el push,
// re-distribuir rompería la confianza con la operación.

interface RestructureInput {
  dispatchId: string;
  /** Lista final de asignaciones tras el cambio. Cada entrada = 1 ruta nueva. */
  vehicleAssignments: Array<{ vehicleId: string; driverId: string | null }>;
}

/**
 * Helper interno: cancela las rutas pre-publicación del tiro, recolecta sus
 * stops y llama a `createAndOptimizeRoute` con los vehículos pedidos.
 *
 * Devuelve los nuevos route ids en éxito o un error legible.
 */
async function restructureDispatchInternal(
  input: RestructureInput,
): Promise<CreateAndOptimizeResult> {
  const dispatchId = requireUuid('dispatchId', input.dispatchId);
  if (input.vehicleAssignments.length === 0) {
    throw new ValidationError('vehicleAssignments', 'Debes asignar al menos un camión.');
  }

  const supabase = await createServerClient();
  const { data: dispatch, error: dErr } = await supabase
    .from('dispatches')
    .select('id, date, zone_id, name')
    .eq('id', dispatchId)
    .maybeSingle();
  if (dErr || !dispatch) throw new ValidationError('dispatchId', 'Tiro no encontrado.');

  // Listar rutas vivas del tiro. Las CANCELLED las ignoramos — su historial queda.
  const allRoutes = await listRoutesByDispatch(dispatchId);
  const liveRoutes = allRoutes.filter((r) => r.status !== 'CANCELLED');

  // Si alguna ruta está post-publicación, abortar — no es seguro re-rutear.
  const POST_PUBLISH = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
  const blocking = liveRoutes.find((r) => POST_PUBLISH.has(r.status));
  if (blocking) {
    throw new ValidationError(
      'status',
      `No se puede re-rutear: la ruta "${blocking.name}" está ${blocking.status}. ` +
        `Cancélala primero o crea un tiro nuevo.`,
    );
  }

  // Recolectar todos los store_ids únicos de las rutas vivas, en orden estable.
  const allStoreIds: string[] = [];
  const seen = new Set<string>();
  for (const r of liveRoutes) {
    const stops = await listStopsForRoute(r.id);
    for (const s of stops) {
      if (!seen.has(s.storeId)) {
        seen.add(s.storeId);
        allStoreIds.push(s.storeId);
      }
    }
  }

  if (allStoreIds.length === 0) {
    throw new ValidationError(
      'stores',
      'El tiro no tiene paradas todavía — agrega rutas con tiendas antes de redistribuir.',
    );
  }

  // Cancelar rutas viejas (status CANCELLED + drop stops) ANTES de crear las nuevas.
  // Esto libera las store_ids para que createAndOptimizeRoute no choque con
  // restricciones de unicidad lógica (una tienda por tiro/día).
  for (const r of liveRoutes) {
    await deleteStopsForRoute(r.id);
    await cancelRoute(r.id);
  }

  // Llamar al action existente — ya orquesta optimizer + persistencia + dispatch.
  const result = await createAndOptimizeRoute({
    name: dispatch.name as string,
    date: dispatch.date as string,
    vehicleIds: input.vehicleAssignments.map((a) => a.vehicleId),
    driverIds: input.vehicleAssignments.map((a) => a.driverId),
    storeIds: allStoreIds,
    dispatchId,
  });

  return result;
}

/**
 * Agrega una camioneta al tiro y re-rutea todo. El dispatcher sólo elige
 * cuál vehículo (y opcionalmente chofer) — el split lo hace VROOM.
 */
export async function addVehicleToDispatchAction(
  dispatchId: string,
  newVehicleId: string,
  newDriverId: string | null,
): Promise<CreateAndOptimizeResult> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    requireUuid('newVehicleId', newVehicleId);
    if (newDriverId) requireUuid('newDriverId', newDriverId);

    // Recoger asignaciones actuales (una por ruta viva) + agregar la nueva.
    const currentRoutes = await listRoutesByDispatch(id);
    const liveRoutes = currentRoutes.filter((r) => r.status !== 'CANCELLED');
    const existingAssignments = liveRoutes.map((r) => ({
      vehicleId: r.vehicleId,
      driverId: r.driverId,
    }));

    // Validar que no estamos duplicando vehículo (rutas distintas no comparten camión).
    if (existingAssignments.some((a) => a.vehicleId === newVehicleId)) {
      throw new ValidationError(
        'newVehicleId',
        'Ese camión ya está en una ruta del tiro.',
      );
    }

    const result = await restructureDispatchInternal({
      dispatchId: id,
      vehicleAssignments: [
        ...existingAssignments,
        { vehicleId: newVehicleId, driverId: newDriverId },
      ],
    });

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${id}`);
    revalidatePath('/routes');
    return result;
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/**
 * Quita una ruta (= una camioneta) del tiro y redistribuye las paradas entre
 * las camionetas restantes. Si era la última, deja el tiro vacío.
 */
export async function removeVehicleFromDispatchAction(
  routeId: string,
): Promise<CreateAndOptimizeResult> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('routeId', routeId);
    const supabase = await createServerClient();
    const { data: route, error: rErr } = await supabase
      .from('routes')
      .select('id, dispatch_id, vehicle_id, status')
      .eq('id', id)
      .maybeSingle();
    if (rErr || !route) throw new ValidationError('routeId', 'Ruta no encontrada.');
    const dispatchId = route.dispatch_id as string | null;
    if (!dispatchId) {
      throw new ValidationError('routeId', 'La ruta no pertenece a un tiro — usa cancelar.');
    }
    if (
      route.status !== 'DRAFT' &&
      route.status !== 'OPTIMIZED' &&
      route.status !== 'APPROVED'
    ) {
      throw new ValidationError(
        'status',
        `No se puede quitar una ruta ${route.status}. Cancélala manualmente si es necesario.`,
      );
    }

    // Recoger las otras rutas vivas (sin la que estamos quitando).
    const allRoutes = await listRoutesByDispatch(dispatchId);
    const remaining = allRoutes.filter(
      (r) => r.id !== id && r.status !== 'CANCELLED',
    );

    // Caso especial: si era la única, sólo cancelar y no llamar al optimizer.
    if (remaining.length === 0) {
      await deleteStopsForRoute(id);
      await cancelRoute(id);
      revalidatePath(`/dispatches/${dispatchId}`);
      revalidatePath('/dispatches');
      revalidatePath('/routes');
      return { ok: true, routeIds: [] };
    }

    const result = await restructureDispatchInternal({
      dispatchId,
      vehicleAssignments: remaining.map((r) => ({
        vehicleId: r.vehicleId,
        driverId: r.driverId,
      })),
    });

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${dispatchId}`);
    revalidatePath('/routes');
    return result;
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}
