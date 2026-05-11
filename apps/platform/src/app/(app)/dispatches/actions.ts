'use server';

// Server Actions de tiros (dispatches). ADR-024 + ADR-025.
// Operaciones: crear, renombrar, eliminar, asignar/desasignar rutas, mover paradas.

import { revalidatePath } from 'next/cache';
import { createServerClient, createServiceRoleClient } from '@verdfrut/supabase/server';
import { logger } from '@verdfrut/observability';
import { requireRole } from '@/lib/auth';
import { moveStopToAnotherRoute, deleteStopsForRoute } from '@/lib/queries/stops';
import { cancelRoute } from '@/lib/queries/routes';
import { listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoute } from '@/lib/queries/stops';
import { computeOptimizationPlan } from '@/lib/optimizer-pipeline';
import { type CreateAndOptimizeResult } from '../routes/actions';
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
  /** Identificador del usuario que ejecuta — para audit y created_by. */
  createdBy: string;
}

/**
 * Snapshot del tiro previo a la redistribución — devolver al UI para banner
 * comparativo (H3.4) y audit.
 */
interface PreRestructureSnapshot {
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  routeCount: number;
  stopCount: number;
}

export interface RestructureDispatchResult extends CreateAndOptimizeResult {
  /** Métricas pre y post para que la UI muestre el delta (H3.4). */
  before?: PreRestructureSnapshot;
  after?: PreRestructureSnapshot;
}

/**
 * Helper interno (ADR-053): two-phase commit.
 *
 *   Fase 1 (fuera de BD): captura snapshot pre, valida estado, llama optimizer
 *     vía `computeOptimizationPlan`. Si falla, return error sin tocar BD.
 *   Fase 2 (RPC Postgres atómica): cancela rutas viejas + inserta nuevas en
 *     una transacción. Si falla, rollback automático → tiro intacto.
 *
 * Esto resuelve el bug original de ADR-048 donde si el optimizer fallaba
 * después de cancelar las rutas viejas, el tiro quedaba vacío. Ahora la
 * cancelación y la inserción son atómicas.
 */
async function restructureDispatchInternal(
  input: RestructureInput,
): Promise<RestructureDispatchResult> {
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

  // Rutas vivas (no CANCELLED).
  const allRoutes = await listRoutesByDispatch(dispatchId);
  const liveRoutes = allRoutes.filter((r) => r.status !== 'CANCELLED');

  // Validar status — no se puede redistribuir post-publicación.
  const POST_PUBLISH = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
  const blocking = liveRoutes.find((r) => POST_PUBLISH.has(r.status));
  if (blocking) {
    throw new ValidationError(
      'status',
      `No se puede re-rutear: la ruta "${blocking.name}" está ${blocking.status}. ` +
        `Cancélala primero o crea un tiro nuevo.`,
    );
  }

  // Recolectar storeIds únicos en orden estable. H3.3: capturar también los
  // depot overrides que existían en cada vehículo para preservarlos en las
  // rutas nuevas (si el dispatcher había cambiado el CEDIS de salida, no
  // queremos perder ese trabajo al redistribuir).
  const allStoreIds: string[] = [];
  const seenStores = new Set<string>();
  const oldDepotOverridesByVehicleId = new Map<string, string>();
  for (const r of liveRoutes) {
    if (r.depotOverrideId) {
      oldDepotOverridesByVehicleId.set(r.vehicleId, r.depotOverrideId);
    }
    const stops = await listStopsForRoute(r.id);
    for (const s of stops) {
      if (!seenStores.has(s.storeId)) {
        seenStores.add(s.storeId);
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

  // Snapshot pre (H3.4): métricas que va a comparar el banner.
  const before: PreRestructureSnapshot = {
    totalDistanceMeters: liveRoutes.reduce((s, r) => s + (r.totalDistanceMeters ?? 0), 0),
    totalDurationSeconds: liveRoutes.reduce((s, r) => s + (r.totalDurationSeconds ?? 0), 0),
    routeCount: liveRoutes.length,
    stopCount: allStoreIds.length,
  };

  // Construir map de overrides para los vehículos que SIGUEN en la nueva
  // asignación (los nuevos pueden no haber tenido override previo, se quedan
  // sin override = depot del vehículo). H3.3.
  const newVehicleIds = new Set(input.vehicleAssignments.map((a) => a.vehicleId));
  const preservedOverrides = new Map<string, string>();
  for (const [vId, depotId] of oldDepotOverridesByVehicleId.entries()) {
    if (newVehicleIds.has(vId)) {
      preservedOverrides.set(vId, depotId);
    }
  }

  // FASE 1: calcular plan via optimizer. SI FALLA AQUÍ, no tocamos BD.
  let plan;
  try {
    plan = await computeOptimizationPlan({
      date: dispatch.date as string,
      vehicleIds: input.vehicleAssignments.map((a) => a.vehicleId),
      driverIds: input.vehicleAssignments.map((a) => a.driverId),
      storeIds: allStoreIds,
      vehicleDepotOverrides: preservedOverrides.size > 0 ? preservedOverrides : undefined,
      routeNamePrefix: dispatch.name as string,
    });
  } catch (err) {
    await logger.error('restructureDispatch: optimizer falló (tiro intacto)', {
      dispatchId, err,
    });
    throw err instanceof Error ? err : new Error('Optimizer falló');
  }

  if (plan.routes.length === 0) {
    throw new ValidationError(
      'optimizer',
      'El optimizador no pudo asignar ninguna parada con la flota seleccionada. ' +
        'Verifica capacidad de vehículos vs demanda total.',
    );
  }

  // FASE 2: RPC atómica. Cancelar rutas viejas + insertar nuevas en transacción.
  const oldRouteIds = liveRoutes.map((r) => r.id);
  const routesJson = plan.routes.map((r) => ({
    vehicle_id: r.vehicleId,
    driver_id: r.driverId ?? '',
    depot_override_id: r.depotOverrideId ?? '',
    name: r.name,
    total_distance_meters: r.totalDistanceMeters,
    total_duration_seconds: r.totalDurationSeconds,
    estimated_start_at: r.estimatedStartAt,
    estimated_end_at: r.estimatedEndAt,
    stops: r.stops.map((s) => ({
      store_id: s.storeId,
      sequence: s.sequence,
      planned_arrival_at: s.plannedArrivalAt,
      planned_departure_at: s.plannedDepartureAt,
      load: s.load,
    })),
  }));

  const admin = createServiceRoleClient();
  const { data: newRouteIds, error: rpcErr } = await admin.rpc(
    'tripdrive_restructure_dispatch',
    {
      p_dispatch_id: dispatchId,
      p_old_route_ids: oldRouteIds,
      p_routes_json: routesJson,
      p_created_by: input.createdBy,
    },
  );

  if (rpcErr) {
    await logger.error('restructureDispatch: RPC falló — tiro queda como estaba', {
      dispatchId, err: rpcErr,
    });
    // Rollback automático del Postgres: el tiro vuelve a su estado previo.
    throw new Error(`Redistribución falló: ${rpcErr.message}`);
  }

  const after: PreRestructureSnapshot = {
    totalDistanceMeters: plan.totalDistanceMeters,
    totalDurationSeconds: plan.totalDurationSeconds,
    routeCount: plan.routes.length,
    stopCount: allStoreIds.length - plan.unassignedStoreIds.length,
  };

  return {
    ok: true,
    routeIds: (newRouteIds as unknown as string[]) ?? [],
    unassignedStoreIds: plan.unassignedStoreIds,
    dispatchId,
    before,
    after,
  };
}

/**
 * Agrega una camioneta al tiro y re-rutea todo. El dispatcher sólo elige
 * cuál vehículo (y opcionalmente chofer) — el split lo hace VROOM.
 */
export async function addVehicleToDispatchAction(
  dispatchId: string,
  newVehicleId: string,
  newDriverId: string | null,
): Promise<RestructureDispatchResult> {
  const profile = await requireRole('admin', 'dispatcher');
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
      createdBy: profile.id,
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
): Promise<RestructureDispatchResult> {
  const profile = await requireRole('admin', 'dispatcher');
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
      createdBy: profile.id,
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
