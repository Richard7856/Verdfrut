'use server';

// Server Actions de tiros (dispatches). ADR-024 + ADR-025.
// Operaciones: crear, renombrar, eliminar, asignar/desasignar rutas, mover paradas.

import { revalidatePath } from 'next/cache';
import { createServerClient, createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';
import { requireRole } from '@/lib/auth';
import { moveStopToAnotherRoute, deleteStopsForRoute } from '@/lib/queries/stops';
import { cancelRoute } from '@/lib/queries/routes';
import { listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoute } from '@/lib/queries/stops';
import { computeOptimizationPlan } from '@/lib/optimizer-pipeline';
import { type CreateAndOptimizeResult, reoptimizeRouteAction } from '../routes/actions';
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
 * #75 — Eliminar/cancelar un tiro completo en cascada.
 *
 * Restricciones que enfrenta:
 *  - `routes.dispatch_id` es NOT NULL (migr 028, ADR-040): toda ruta debe vivir
 *    en un tiro → no se puede dejar rutas huérfanas.
 *  - `routes.dispatch_id` FK ON DELETE RESTRICT: no se puede borrar un tiro
 *    con rutas dentro.
 *  - Las rutas pre-publish (DRAFT/OPTIMIZED/APPROVED) NO tienen valor
 *    histórico — nunca llegaron al chofer; se pueden DELETE.
 *  - Las rutas PUBLISHED/IN_PROGRESS sí tienen valor (chofer las recibió);
 *    no se borran, se CANCELAN.
 *  - Las históricas (CANCELLED/COMPLETED/INTERRUPTED) son inmutables.
 *
 * Comportamiento resultante:
 *  - **Tiro 100% pre-publish:** DELETE rutas (cascade limpia stops, etc.) +
 *    DELETE dispatch. Limpio.
 *  - **Tiro con rutas activas + `confirmActive`:** cancela las activas, deja
 *    el dispatch como histórico (NO se borra). UI debe reflejarlo.
 *  - **Tiro con rutas activas sin `confirmActive`:** abortamos pidiendo confirm.
 *  - **Tiro con histórico:** NO se borra (las rutas históricas se quedan), pero
 *    cancelamos cualquier pre-publish/activa restante para que el tiro quede limpio.
 */
export async function deleteDispatchAction(
  dispatchId: string,
  opts?: { confirmActive?: boolean },
): Promise<ActionResult & { activeRoutesCount?: number; dispatchKept?: boolean }> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    const routes = await listRoutesByDispatch(id);

    const PURGABLE = new Set(['DRAFT', 'OPTIMIZED', 'APPROVED']);
    const ACTIVE = new Set(['PUBLISHED', 'IN_PROGRESS']);
    const HISTORIC = new Set(['CANCELLED', 'COMPLETED', 'INTERRUPTED']);

    const purgable = routes.filter((r) => PURGABLE.has(r.status));
    const active = routes.filter((r) => ACTIVE.has(r.status));
    const historic = routes.filter((r) => HISTORIC.has(r.status));

    // Gate: si hay rutas activas, requerir confirmación explícita.
    if (active.length > 0 && !opts?.confirmActive) {
      return {
        ok: false,
        error: `Hay ${active.length} ruta(s) publicada(s) o en curso. Confirma para cancelarlas.`,
        activeRoutesCount: active.length,
      };
    }

    const supabase = await createServerClient();

    // 1. DELETE rutas pre-publish (CASCADE limpia stops/breadcrumbs/etc).
    if (purgable.length > 0) {
      const { error: delRoutesErr } = await supabase
        .from('routes')
        .delete()
        .in(
          'id',
          purgable.map((r) => r.id),
        );
      if (delRoutesErr) {
        await logger.error('[deleteDispatchAction] falló DELETE rutas pre-publish', {
          err: delRoutesErr,
          dispatchId: id,
          routeIds: purgable.map((r) => r.id),
        });
        throw new Error(`No se pudieron borrar las rutas pre-publish: ${delRoutesErr.message}`);
      }
    }

    // 2. Cancelar rutas activas (UPDATE status='CANCELLED'). Histórico operativo.
    if (active.length > 0) {
      const { error: cancelErr } = await supabase
        .from('routes')
        .update({ status: 'CANCELLED' })
        .in(
          'id',
          active.map((r) => r.id),
        );
      if (cancelErr) {
        await logger.error('[deleteDispatchAction] falló cancelación rutas activas', {
          err: cancelErr,
          dispatchId: id,
          routeIds: active.map((r) => r.id),
        });
        throw new Error(`No se pudieron cancelar las rutas activas: ${cancelErr.message}`);
      }
    }

    // 3. DELETE dispatch SOLO si no quedan rutas (activas o históricas) que lo
    //    referencien. Si hay histórico o se acaba de cancelar algo, el tiro
    //    queda como contenedor del histórico (sin poder borrarse).
    const dispatchKept = historic.length > 0 || active.length > 0;
    if (!dispatchKept) {
      const { error: delErr } = await supabase.from('dispatches').delete().eq('id', id);
      if (delErr) {
        await logger.error('[deleteDispatchAction] falló DELETE dispatch', {
          err: delErr,
          dispatchId: id,
        });
        throw new Error(delErr.message);
      }
    }

    revalidatePath('/dispatches');
    revalidatePath('/routes');
    revalidatePath(`/dispatches/${id}`);
    return { ok: true, dispatchKept };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/**
 * ADR-046: habilita el enlace público read-only del tiro. Genera token UUID
 * y devuelve el path /share/dispatch/{token} para que el cliente arme la URL
 * completa con su window.location.origin.
 */
export interface ShareLinkResult extends ActionResult {
  token?: string;
  path?: string;
  /** HARDENING C2: ISO timestamp cuando expira el link (default 7d). */
  expiresAt?: string;
}

export async function enableDispatchSharingAction(
  dispatchId: string,
): Promise<ShareLinkResult> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    const { enableDispatchSharing } = await import('@/lib/queries/dispatches');
    const { token, expiresAt } = await enableDispatchSharing(id);
    revalidatePath(`/dispatches/${id}`);
    return { ok: true, token, expiresAt, path: `/share/dispatch/${token}` };
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
 * Agrega una camioneta como ruta VACÍA al tiro — sin re-optimizar.
 *
 * El dispatcher prefiere agregar la camioneta vacía y mover paradas a mano
 * desde el mapa (selección bulk + "Mover a → camioneta nueva"). Si quiere que
 * VROOM rebalance, usa el botón "⚡ Optimizar tiro → Mover entre camionetas".
 *
 * Antes (ADR-048): "agregar camioneta" disparaba un re-rutee automático que
 * borraba todas las paradas y las redistribuía con VROOM. Esto a) sobrescribía
 * el trabajo manual del dispatcher, b) en algunos tiros multi-zona dejaba 10+
 * paradas sin asignar porque VROOM no podía con la flota dada. El user pidió
 * separar las dos operaciones: agregar ≠ optimizar.
 */
export async function addEmptyRouteToDispatchAction(
  dispatchId: string,
  vehicleId: string,
  driverId: string | null,
): Promise<ActionResult & { routeId?: string }> {
  const profile = await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    requireUuid('vehicleId', vehicleId);
    if (driverId) requireUuid('driverId', driverId);

    const supabase = await createServerClient();

    // Una sola query: necesitamos date + zone_id + name para construir el
    // payload del insert. Antes hacíamos 3 queries adicionales (uniqueness,
    // vehicle exists, vehicle active) que el DB ya garantiza:
    //   - UNIQUE(vehicle_id, date) WHERE status != CANCELLED (índice idx_routes_vehicle_date_active)
    //   - FK routes.vehicle_id → vehicles
    //   - El dropdown del cliente solo muestra vehículos activos de la zona.
    // El insert mismo levanta error si algo viola constraints y lo
    // traducimos a un mensaje legible abajo.
    //
    // Para el nombre "ruta N+1" usamos un COUNT rápido en lugar de listar
    // todas las filas + computar length client-side.
    const [dispatchRes, countRes] = await Promise.all([
      supabase
        .from('dispatches')
        .select('id, name, date, zone_id')
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('routes')
        .select('id', { count: 'exact', head: true })
        .eq('dispatch_id', id)
        .neq('status', 'CANCELLED'),
    ]);
    if (dispatchRes.error || !dispatchRes.data) {
      throw new ValidationError('dispatchId', 'Tiro no encontrado.');
    }
    const dispatch = dispatchRes.data;
    const liveCount = countRes.count ?? 0;
    const routeName = `${dispatch.name as string} — ruta ${liveCount + 1}`;

    const { data: route, error: rErr } = await supabase
      .from('routes')
      .insert({
        dispatch_id: id,
        name: routeName,
        date: dispatch.date as string,
        zone_id: dispatch.zone_id as string,
        vehicle_id: vehicleId,
        driver_id: driverId,
        status: 'DRAFT',
        created_by: profile.id,
      })
      .select('id')
      .single();
    if (rErr || !route) {
      // Postgres 23505 = unique_violation. El índice idx_routes_vehicle_date_active
      // bloquea agregar la misma camioneta dos veces el mismo día (en estados vivos).
      if (rErr?.code === '23505') {
        return { ok: false, error: 'Esa camioneta ya está en una ruta del tiro.' };
      }
      return {
        ok: false,
        error: `No se pudo crear la ruta: ${rErr?.message ?? 'desconocido'}`,
      };
    }

    // Solo revalida la página del tiro — /dispatches y /routes recargan al
    // próximo navigate. Antes revalidábamos las 3, lo que invalidaba caches
    // grandes innecesariamente.
    revalidatePath(`/dispatches/${id}`);

    return { ok: true, routeId: route.id as string };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/**
 * Agrega una camioneta al tiro y re-rutea todo. El dispatcher sólo elige
 * cuál vehículo (y opcionalmente chofer) — el split lo hace VROOM.
 *
 * @deprecated Para uso del orchestrator AI (`add_vehicle_to_dispatch` tool) y
 * compatibilidad. La UI usa `addEmptyRouteToDispatchAction` que NO auto-optimiza.
 * Si el dispatcher quiere rebalance, lo dispara explícito desde "⚡ Optimizar tiro".
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

// ─────────────────────────────────────────────────────────────────────
// Bulk operations en stops (Phase 2 del mapa con selección masiva)
// ─────────────────────────────────────────────────────────────────────

export interface BulkMoveStopsResult {
  moved: number;
  failed: Array<{ stopId: string; reason: string }>;
  /**
   * IDs de rutas que se vieron afectadas (origen y destino). Útil para que
   * el cliente sugiera "optimizar la ruta destino con VROOM" si quedó con
   * stops apendizados al final sin secuencia óptima.
   */
  affectedRouteIds: string[];
}

/**
 * Mueve N stops a una ruta destino en una sola operación.
 *
 * Implementación: itera sobre `moveStopToAnotherRoute(stopId, targetRouteId)`
 * que ya valida estado, calcula sequence, re-numera origen, y recalcula
 * métricas. La penalty de N recálculos es ~50ms × N — aceptable para
 * batches típicos (≤30 stops).
 *
 * Si falla algún stop individual (ej. ya está completed), lo agregamos a
 * `failed` y seguimos con los demás. Operación parcial es OK — el user
 * ve el reporte y decide.
 */
export async function bulkMoveStopsAction(
  stopIds: string[],
  targetRouteId: string,
  /**
   * Contexto opcional para revalidation. Si se pasa `dispatchId`, revalida
   * /dispatches/[dispatchId] (uso legacy desde el detalle de un tiro). Si se
   * pasa `fecha`, revalida /dia/[fecha] (uso nuevo desde la vista por día,
   * UX-Fase 2). Si ninguno, revalida solo /routes + paths inferidos.
   *
   * Cross-dispatch: las paradas pueden venir de rutas de DIFERENTES dispatches.
   * `moveStopToAnotherRoute` no valida ownership de dispatch (solo status de
   * ruta), así que el move es transparente entre tiros. Computamos los
   * dispatchIds afectados dinámicamente y los revalidamos todos.
   */
  context?: { dispatchId?: string; fecha?: string },
): Promise<ActionResult & { result?: BulkMoveStopsResult }> {
  try {
    await requireRole('admin', 'dispatcher');
    if (!Array.isArray(stopIds) || stopIds.length === 0) {
      return { ok: false, error: 'No se recibieron stops para mover.' };
    }
    if (stopIds.length > 200) {
      return { ok: false, error: 'Máximo 200 stops por operación bulk.' };
    }
    requireUuid('targetRouteId', targetRouteId);
    if (context?.dispatchId) requireUuid('dispatchId', context.dispatchId);
    if (context?.fecha && !/^\d{4}-\d{2}-\d{2}$/.test(context.fecha)) {
      return { ok: false, error: 'fecha debe ser YYYY-MM-DD' };
    }

    let moved = 0;
    const failed: BulkMoveStopsResult['failed'] = [];
    const affectedRoutes = new Set<string>([targetRouteId]);

    for (const stopId of stopIds) {
      try {
        requireUuid('stopId', stopId);
        // Capturar la ruta origen antes del move para audit + tracking.
        const supabase = await createServerClient();
        const { data: stopRow } = await supabase
          .from('stops')
          .select('route_id')
          .eq('id', stopId)
          .maybeSingle();
        const sourceRouteId = stopRow?.route_id as string | undefined;

        await moveStopToAnotherRoute(stopId, targetRouteId);
        moved++;
        if (sourceRouteId) affectedRoutes.add(sourceRouteId);
      } catch (err) {
        failed.push({
          stopId,
          reason: err instanceof Error ? err.message : 'Error desconocido',
        });
      }
    }

    // Computar dispatches afectados desde las rutas afectadas — para
    // revalidar /dispatches/[id] de cada uno (cross-dispatch moves).
    const affectedDispatches = new Set<string>();
    if (affectedRoutes.size > 0) {
      const supabase = await createServerClient();
      const { data: routeRows } = await supabase
        .from('routes')
        .select('id, dispatch_id')
        .in('id', Array.from(affectedRoutes));
      for (const r of routeRows ?? []) {
        if (r.dispatch_id) affectedDispatches.add(r.dispatch_id as string);
      }
    }

    // Revalidación: el path explícito del caller + cada dispatch afectado +
    // /routes (donde aparecen rutas individuales).
    if (context?.dispatchId) revalidatePath(`/dispatches/${context.dispatchId}`);
    if (context?.fecha) revalidatePath(`/dia/${context.fecha}`);
    for (const dId of affectedDispatches) {
      revalidatePath(`/dispatches/${dId}`);
    }
    revalidatePath('/routes');

    logger.info('dispatches.bulk_move_stops', {
      dispatch_id_ctx: context?.dispatchId ?? null,
      fecha_ctx: context?.fecha ?? null,
      target_route_id: targetRouteId,
      requested: stopIds.length,
      moved,
      failed: failed.length,
      affected_dispatches: Array.from(affectedDispatches),
    });

    return {
      ok: true,
      result: {
        moved,
        failed,
        affectedRouteIds: [...affectedRoutes],
      },
    };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Optimización del tiro completo — dos modos
// ─────────────────────────────────────────────────────────────────────
// El dispatcher ve un tiro con N rutas en DRAFT/OPTIMIZED y quiere mejorarlo.
// Dos intenciones distintas:
//
//   mode='across'  → mover tiendas entre camionetas (rebalance global). Reusa
//                    restructureDispatchInternal con las mismas asignaciones
//                    actuales — el optimizer decide el split.
//   mode='within'  → solo reordenar dentro de cada camioneta (sin cambiar a qué
//                    camión va cada tienda). Llama reoptimizeRouteAction por ruta.
//
// La separación importa porque el dispatcher suele tener un trabajo manual
// (movió X tienda al camión Y a propósito) que NO quiere perder al optimizar.
// 'within' respeta esa decisión; 'across' la sobreescribe.

export interface OptimizeDispatchResult extends ActionResult {
  mode?: 'across' | 'within';
  routesOptimized?: number;
  routesFailed?: Array<{ routeId: string; reason: string }>;
  unassignedStoreIds?: string[];
  before?: PreRestructureSnapshot;
  after?: PreRestructureSnapshot;
}

export async function optimizeDispatchAction(
  dispatchId: string,
  mode: 'across' | 'within',
): Promise<OptimizeDispatchResult> {
  const profile = await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', dispatchId);
    if (mode !== 'across' && mode !== 'within') {
      throw new ValidationError('mode', 'Modo inválido. Usa "across" o "within".');
    }

    const routes = await listRoutesByDispatch(id);
    const liveRoutes = routes.filter((r) => r.status !== 'CANCELLED');
    if (liveRoutes.length === 0) {
      throw new ValidationError('routes', 'El tiro no tiene rutas vivas para optimizar.');
    }

    // Validación común: ninguna ruta puede estar post-publicación. Si la hay,
    // el dispatcher debe usar el flujo de re-optimización en vivo desde la ruta.
    const POST_PUBLISH = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
    const blocking = liveRoutes.find((r) => POST_PUBLISH.has(r.status));
    if (blocking) {
      throw new ValidationError(
        'status',
        `No se puede optimizar: la ruta "${blocking.name}" está ${blocking.status}. ` +
          `Usa "Re-optimizar con tráfico" en la ruta individual.`,
      );
    }

    if (mode === 'across') {
      // Rebalance global preservando las asignaciones (mismos vehículos/choferes).
      const result = await restructureDispatchInternal({
        dispatchId: id,
        vehicleAssignments: liveRoutes.map((r) => ({
          vehicleId: r.vehicleId,
          driverId: r.driverId,
        })),
        createdBy: profile.id,
      });
      revalidatePath('/dispatches');
      revalidatePath(`/dispatches/${id}`);
      revalidatePath('/routes');
      return {
        ok: result.ok,
        error: result.error,
        mode: 'across',
        routesOptimized: result.ok ? liveRoutes.length : 0,
        unassignedStoreIds: result.unassignedStoreIds,
        before: result.before,
        after: result.after,
      };
    }

    // mode === 'within': loop por ruta. Cada llamada es independiente — si una
    // falla (capacidad, sin tiendas), seguimos con las demás y reportamos.
    let optimized = 0;
    const failed: Array<{ routeId: string; reason: string }> = [];
    const unassignedAll: string[] = [];
    for (const r of liveRoutes) {
      if (!['DRAFT', 'OPTIMIZED'].includes(r.status)) {
        failed.push({ routeId: r.id, reason: `Ruta ${r.status} no se puede optimizar.` });
        continue;
      }
      const res = await reoptimizeRouteAction(r.id);
      if (res.ok) {
        optimized++;
        if (res.unassignedStoreIds) unassignedAll.push(...res.unassignedStoreIds);
      } else {
        failed.push({ routeId: r.id, reason: res.error ?? 'Error desconocido' });
      }
    }

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${id}`);
    revalidatePath('/routes');

    return {
      ok: optimized > 0 || failed.length === 0,
      mode: 'within',
      routesOptimized: optimized,
      routesFailed: failed.length > 0 ? failed : undefined,
      unassignedStoreIds: unassignedAll.length > 0 ? unassignedAll : undefined,
      error:
        optimized === 0 && failed.length > 0
          ? `Ninguna ruta se pudo optimizar (${failed.length} fallaron).`
          : undefined,
    };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// UX-Fase 2: Optimizar todo el día (loop within-truck across all dispatches)
// ─────────────────────────────────────────────────────────────────────
//
// Re-optimiza CADA ruta DRAFT/OPTIMIZED del día (sin mover paradas entre
// camionetas — eso requiere cross-plan rebalance que es UX-Fase 3). Es la
// versión bulk de "Re-optimizar" del card de ruta, aplicada a todas las
// rutas del día con un click.

export interface OptimizeDayResult extends ActionResult {
  fecha?: string;
  routesOptimized?: number;
  routesFailed?: Array<{ routeId: string; reason: string }>;
}

export async function optimizeDayAction(fecha: string): Promise<OptimizeDayResult> {
  await requireRole('admin', 'dispatcher');
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      throw new ValidationError('fecha', 'fecha debe ser YYYY-MM-DD');
    }

    const supabase = await createServerClient();
    const { data: dayRoutes, error: rErr } = await supabase
      .from('routes')
      .select('id, status')
      .eq('date', fecha)
      .in('status', ['DRAFT', 'OPTIMIZED']);
    if (rErr) throw new Error(rErr.message);
    if (!dayRoutes || dayRoutes.length === 0) {
      return {
        ok: true,
        fecha,
        routesOptimized: 0,
        routesFailed: [],
        error: 'No hay rutas optimizables (DRAFT/OPTIMIZED) en este día.',
      };
    }

    // Loop secuencial — paralelo causaría thrashing en el optimizer (VROOM
    // self-hosted con queue limitada). En 10 rutas tardará ~30s; aceptable
    // como UX (toast pending + reload).
    let optimized = 0;
    const failed: Array<{ routeId: string; reason: string }> = [];
    for (const r of dayRoutes) {
      const res = await reoptimizeRouteAction(r.id as string);
      if (res.ok) {
        optimized++;
      } else {
        failed.push({
          routeId: r.id as string,
          reason: res.error ?? 'Error desconocido',
        });
      }
    }

    revalidatePath(`/dia/${fecha}`);
    revalidatePath('/routes');

    logger.info('dispatches.optimize_day', {
      fecha,
      total: dayRoutes.length,
      optimized,
      failed: failed.length,
    });

    return {
      ok: optimized > 0 || failed.length === 0,
      fecha,
      routesOptimized: optimized,
      routesFailed: failed.length > 0 ? failed : undefined,
      error:
        optimized === 0 && failed.length > 0
          ? `Ninguna ruta se pudo optimizar (${failed.length} fallaron).`
          : undefined,
    };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// OE-3: Aplicar una alternativa de propose_route_plan
// ─────────────────────────────────────────────────────────────────────
//
// `proposeRoutePlans()` calcula 2-3 alternativas (cheapest/balanced/fastest)
// con costo MXN. Esta acción ejecuta la alternativa elegida: re-rutea el
// tiro con el conjunto exacto de vehículos+choferes de la opción.
//
// Por simplicidad esta fase, NO usamos el plan precomputado (que tendría
// stops + sequences + ETAs ya resueltas). Reusamos `restructureDispatchInternal`
// que vuelve a correr VROOM con los vehículos elegidos. Trade-off: 30-60s
// extra de latencia vs riesgo de drift si los datos cambiaron entre propose
// y apply. Cuando salgan los datos en producción podemos cachear el plan
// completo en la propose-routes response y skip VROOM acá (OE-3.1).

export interface ApplyRoutePlanResult extends RestructureDispatchResult {
  /** El label de la alternativa que el user eligió (cheapest/balanced/fastest). */
  appliedLabel?: string;
}

export async function applyRoutePlanAction(input: {
  dispatchId: string;
  /** Lista de assignments del alternativo elegido. */
  vehicleAssignments: Array<{ vehicleId: string; driverId: string | null }>;
  /** Label informativo para audit (cheapest / balanced / fastest). */
  appliedLabel?: string;
}): Promise<ApplyRoutePlanResult> {
  const profile = await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('dispatchId', input.dispatchId);
    if (!Array.isArray(input.vehicleAssignments) || input.vehicleAssignments.length === 0) {
      throw new ValidationError(
        'vehicleAssignments',
        'Necesitas al menos 1 vehículo en la alternativa elegida.',
      );
    }
    for (const a of input.vehicleAssignments) {
      requireUuid('vehicleId', a.vehicleId);
      if (a.driverId) requireUuid('driverId', a.driverId);
    }

    const result = await restructureDispatchInternal({
      dispatchId: id,
      vehicleAssignments: input.vehicleAssignments,
      createdBy: profile.id,
    });

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${id}`);
    revalidatePath(`/dispatches/${id}/propose`);
    revalidatePath('/routes');

    logger.info('dispatches.apply_route_plan', {
      dispatch_id: id,
      applied_label: input.appliedLabel,
      vehicle_count: input.vehicleAssignments.length,
      triggered_by: profile.id,
    });

    return {
      ...result,
      appliedLabel: input.appliedLabel,
    };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}
