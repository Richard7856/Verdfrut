'use server';

// Server Actions del flujo de rutas.
// La acción crítica es createAndOptimizeRoute: orquesta queries + optimizer en una transacción lógica.

import { revalidatePath } from 'next/cache';
import { localTimeToUnix } from '@tripdrive/utils';
import { requireRole } from '@/lib/auth';
import {
  createDraftRoute,
  getRoute,
  markRouteOptimized,
  approveRoute,
  publishRoute,
  cancelRoute,
  assignDriverToRoute,
  assignDepotOverrideToRoute,
  recalculateRouteMetrics,
  resetRouteToDraft,
  incrementRouteVersion,
} from '@/lib/queries/routes';
import {
  bulkReorderStops,
  createStops,
  deleteStopsForRoute,
  listStopsForRoute,
  appendStopToRoute,
  deleteStopFromRoute,
} from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDriversByIds } from '@/lib/queries/drivers';
import { listDepots } from '@/lib/queries/depots';
import { callOptimizer, getUnassignedStoreIds } from '@/lib/optimizer';
import { notifyDriverOfPublishedRoute, notifyDriverOfRouteChange } from '@/lib/push';
import { requireUuid, runAction, ValidationError, type ActionResult } from '@/lib/validation';

const TENANT_TIMEZONE = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

interface CreateAndOptimizeInput {
  name: string;
  date: string;            // YYYY-MM-DD (hora local del tenant)
  vehicleIds: string[];
  /** Driver opcional por vehículo. Misma longitud que vehicleIds. NULL = sin asignar (asignación posterior). */
  driverIds?: Array<string | null>;
  storeIds: string[];
  /** Hora de inicio del turno (HH:MM, hora local del tenant). Default 06:00. */
  shiftStart?: string;
  /** Hora de fin (HH:MM). Default 14:00. */
  shiftEnd?: string;
  /**
   * ADR-040: tiro al que pertenece la ruta. Si null/undefined, se crea uno
   * automáticamente con name "Tiro DD/MM" para que toda ruta viva dentro de
   * un dispatch (constraint NOT NULL en DB). Si viene, se valida que la fecha
   * y zona coincidan con el tiro existente.
   */
  dispatchId?: string | null;
}

export interface CreateAndOptimizeResult {
  ok: boolean;
  error?: string;
  routeIds?: string[];
  unassignedStoreIds?: string[];
  /** ADR-040: dispatch id (existente o auto-creado) — el form redirige a su detalle. */
  dispatchId?: string;
}

/**
 * Crea N rutas DRAFT (una por vehículo), corre el optimizer, persiste las stops,
 * marca las rutas como OPTIMIZED. Si el optimizer no puede asignar todas las paradas,
 * devuelve los IDs no asignados — el dispatcher decide qué hacer.
 *
 * Atomicidad (C3): si algún INSERT falla a mitad del flujo, las rutas ya creadas
 * en este intento se cancelan via rollback manual. Para atomicidad real (rollback de
 * todo el lote), habría que mover esto a una RPC Postgres — pendiente para producción.
 */
export async function createAndOptimizeRoute(
  input: CreateAndOptimizeInput,
): Promise<CreateAndOptimizeResult> {
  const profile = await requireRole('admin', 'dispatcher');
  const createdRouteIds: string[] = [];

  try {
    if (input.vehicleIds.length === 0) throw new ValidationError('vehicleIds', 'Selecciona al menos un camión');
    if (input.storeIds.length === 0) throw new ValidationError('storeIds', 'Selecciona al menos una tienda');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      throw new ValidationError('date', 'Fecha debe ser YYYY-MM-DD');
    }
    if (input.driverIds && input.driverIds.length !== input.vehicleIds.length) {
      throw new ValidationError('driverIds', 'driverIds debe tener la misma longitud que vehicleIds');
    }

    // 1. Cargar entidades.
    const driverIds = (input.driverIds ?? []).filter((d): d is string => Boolean(d));
    const [vehicles, stores, drivers] = await Promise.all([
      getVehiclesByIds(input.vehicleIds),
      getStoresByIds(input.storeIds),
      driverIds.length > 0 ? getDriversByIds(driverIds) : Promise.resolve([]),
    ]);
    if (vehicles.length !== input.vehicleIds.length) throw new Error('Algún camión no existe');
    if (stores.length !== input.storeIds.length) throw new Error('Alguna tienda no existe');

    // 2. Validar misma zona (asunción del optimizador V1: una corrida = una zona).
    const zoneId = vehicles[0]?.zoneId;
    if (!zoneId) throw new Error('No se pudo determinar la zona del camión');
    if (!vehicles.every((v) => v.zoneId === zoneId)) {
      throw new Error('Todos los camiones deben pertenecer a la misma zona');
    }
    if (!stores.every((s) => s.zoneId === zoneId)) {
      throw new Error('Todas las tiendas deben pertenecer a la misma zona que los camiones');
    }
    // Validar que los choferes (si vienen) sean de la misma zona.
    if (drivers.length > 0 && !drivers.every((d) => d.zoneId === zoneId)) {
      throw new Error('Todos los choferes asignados deben pertenecer a la misma zona');
    }

    // 3. Construir ventana del turno respetando la TZ del tenant (C1).
    const shiftStart = input.shiftStart ?? '06:00';
    const shiftEnd = input.shiftEnd ?? '14:00';
    const shiftStartUnix = localTimeToUnix(input.date, shiftStart, TENANT_TIMEZONE);
    const shiftEndUnix = localTimeToUnix(input.date, shiftEnd, TENANT_TIMEZONE);
    if (shiftEndUnix <= shiftStartUnix) {
      throw new ValidationError('shift', 'El fin del turno debe ser posterior al inicio');
    }

    // 4. Llamar al optimizer con demand POR tienda (C5) y depots resueltos.
    const depots = await listDepots({ zoneId });
    const depotsById = new Map(depots.map((d) => [d.id, d]));
    const optResponse = await callOptimizer(vehicles, stores, {
      shiftStartUnix,
      shiftEndUnix,
      shiftDate: input.date,
      timezone: TENANT_TIMEZONE,
      depotsById,
    });

    // 4.5. ADR-040: garantizar que existe un dispatch al cual asociar las rutas.
    //   - Si el caller pasó dispatchId, validar que existe y coincide en (date, zone).
    //   - Si no, auto-crear uno con name "Tiro DD/MM" + el name del input como notas.
    // Toda ruta DEBE tener dispatch_id (constraint NOT NULL en DB desde migr 028).
    let resolvedDispatchId: string;
    {
      const supabase = await (await import('@tripdrive/supabase/server')).createServerClient();
      if (input.dispatchId) {
        const { data: existing, error: dErr } = await supabase
          .from('dispatches')
          .select('id, date, zone_id')
          .eq('id', input.dispatchId)
          .maybeSingle();
        if (dErr || !existing) {
          throw new ValidationError('dispatchId', 'Tiro no encontrado');
        }
        if (existing.date !== input.date || existing.zone_id !== zoneId) {
          throw new ValidationError(
            'dispatchId',
            'El tiro pertenece a otra fecha o zona — la ruta no se puede asociar.',
          );
        }
        resolvedDispatchId = existing.id as string;
      } else {
        // Auto-crear con name humano-amigable. La fecha en formato DD/MM es lo
        // que el dispatcher reconoce a simple vista; el name del input queda en
        // notes para trazabilidad si lo necesita después.
        const [yyyy, mm, dd] = input.date.split('-');
        const { data: newDispatch, error: ndErr } = await supabase
          .from('dispatches')
          .insert({
            name: `Tiro ${dd}/${mm}`,
            date: input.date,
            zone_id: zoneId,
            notes: `Auto-creado al crear "${input.name}" (ADR-040).`,
            created_by: profile.id,
          })
          .select('id')
          .single();
        if (ndErr || !newDispatch) {
          // Si falla por UNIQUE (ya hay un "Tiro DD/MM" del mismo día/zona), reusar.
          if (ndErr?.code === '23505') {
            const { data: existing2 } = await supabase
              .from('dispatches')
              .select('id')
              .eq('date', input.date)
              .eq('zone_id', zoneId)
              .eq('name', `Tiro ${dd}/${mm}`)
              .maybeSingle();
            if (!existing2) throw new Error(`[autoDispatch] ${ndErr.message}`);
            resolvedDispatchId = existing2.id as string;
          } else {
            throw new Error(`[autoDispatch] ${ndErr?.message ?? 'fallo al auto-crear tiro'}`);
          }
        } else {
          resolvedDispatchId = newDispatch.id as string;
        }
      }
    }

    // 5. Crear una route DRAFT por vehículo y persistir sus stops.
    for (let i = 0; i < vehicles.length; i++) {
      const vehicle = vehicles[i];
      if (!vehicle) continue;
      const optRoute = optResponse.routes.find((r) => r.vehicle_id === i + 1);
      const driverIdForVehicle = input.driverIds?.[i] ?? null;

      // C1 fix — si el optimizer no le asignó paradas a este vehículo, NO crear ruta vacía.
      // El vehículo aparece en el resultado como "no asignado" implícitamente.
      if (!optRoute || optRoute.steps.length === 0) {
        continue;
      }

      const route = await createDraftRoute({
        name: `${input.name} — ${vehicle.alias ?? vehicle.plate}`,
        date: input.date,
        vehicleId: vehicle.id,
        driverId: driverIdForVehicle,
        zoneId: vehicle.zoneId,
        createdBy: profile.id,
        // ADR-040: dispatch_id NOT NULL — toda ruta vive dentro de un tiro.
        dispatchId: resolvedDispatchId,
      });
      createdRouteIds.push(route.id);

      const stopsToInsert = optRoute.steps.map((step, idx) => {
        const store = stores[step.job_id - 1];
        if (!store) throw new Error(`Optimizer devolvió job_id inválido: ${step.job_id}`);
        return {
          storeId: store.id,
          sequence: idx + 1,
          plannedArrivalAt: new Date(step.arrival * 1000).toISOString(),
          plannedDepartureAt: new Date(step.departure * 1000).toISOString(),
          load: step.load,
        };
      });
      await createStops({ routeId: route.id, stops: stopsToInsert });

      const firstStep = optRoute.steps[0];
      const lastStep = optRoute.steps[optRoute.steps.length - 1];
      await markRouteOptimized(route.id, {
        totalDistanceMeters: optRoute.distance,
        totalDurationSeconds: optRoute.duration,
        estimatedStartAt: new Date((firstStep?.arrival ?? shiftStartUnix) * 1000).toISOString(),
        estimatedEndAt: new Date((lastStep?.departure ?? shiftEndUnix) * 1000).toISOString(),
      });
    }

    const unassignedStoreIds = getUnassignedStoreIds(optResponse, stores);

    revalidatePath('/routes');
    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${resolvedDispatchId}`);

    return {
      ok: true,
      routeIds: createdRouteIds,
      unassignedStoreIds,
      dispatchId: resolvedDispatchId,
    };
  } catch (err) {
    // C3 — rollback manual: cancelar todas las rutas que alcanzamos a crear.
    if (createdRouteIds.length > 0) {
      console.error(
        `[createAndOptimizeRoute] Rollback ${createdRouteIds.length} rutas por error:`,
        err,
      );
      await Promise.allSettled(createdRouteIds.map((id) => cancelRoute(id)));
    }

    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

/**
 * Re-optimiza una ruta DRAFT u OPTIMIZED, manteniendo el mismo route_id.
 * Útil cuando el dispatcher quiere ajustar paradas (agregar/quitar) y volver a correr el optimizer.
 *
 * Flujo:
 *   1. Lee la ruta + sus stops actuales para derivar storeIds
 *   2. Si llegan extraStoreIds o removeStoreIds, ajusta la lista
 *   3. Resetea la ruta a DRAFT y borra stops
 *   4. Llama al optimizer con la nueva lista
 *   5. Inserta stops nuevas y marca OPTIMIZED
 *
 * Solo permitido en DRAFT u OPTIMIZED. Para APPROVED+ habría que primero des-aprobar.
 */
export async function reoptimizeRouteAction(
  routeId: string,
  opts?: {
    addStoreIds?: string[];
    removeStoreIds?: string[];
    shiftStart?: string;
    shiftEnd?: string;
  },
): Promise<CreateAndOptimizeResult> {
  await requireRole('admin', 'dispatcher');

  try {
    const id = requireUuid('routeId', routeId);
    const route = await getRoute(id);
    if (!route) throw new ValidationError('routeId', 'Ruta no existe');
    if (!['DRAFT', 'OPTIMIZED'].includes(route.status)) {
      throw new ValidationError(
        'status',
        `Solo se puede re-optimizar en estados DRAFT u OPTIMIZED (actual: ${route.status})`,
      );
    }

    // Derivar lista actual de stores desde stops existentes
    const currentStops = await listStopsForRoute(id);
    let storeIds = currentStops.map((s) => s.storeId);

    // Aplicar adds/removes
    if (opts?.removeStoreIds) {
      storeIds = storeIds.filter((sid) => !opts.removeStoreIds!.includes(sid));
    }
    if (opts?.addStoreIds) {
      const additions = opts.addStoreIds.filter((sid) => !storeIds.includes(sid));
      storeIds = [...storeIds, ...additions];
    }

    if (storeIds.length === 0) {
      throw new ValidationError('storeIds', 'La ruta debe tener al menos una tienda');
    }

    // Cargar entidades
    const [vehicles, stores] = await Promise.all([
      getVehiclesByIds([route.vehicleId]),
      getStoresByIds(storeIds),
    ]);
    const vehicle = vehicles[0];
    if (!vehicle) throw new Error('Camión asociado a la ruta no existe');
    if (stores.length !== storeIds.length) throw new Error('Alguna tienda no existe');

    // Validar misma zona
    if (!stores.every((s) => s.zoneId === vehicle.zoneId)) {
      throw new Error('Todas las tiendas deben pertenecer a la misma zona del camión');
    }

    // Construir shift en TZ del tenant
    const shiftStart = opts?.shiftStart ?? '06:00';
    const shiftEnd = opts?.shiftEnd ?? '14:00';
    const shiftStartUnix = localTimeToUnix(route.date, shiftStart, TENANT_TIMEZONE);
    const shiftEndUnix = localTimeToUnix(route.date, shiftEnd, TENANT_TIMEZONE);

    // Llamar al optimizer (con depots de todas las zonas — override puede apuntar a uno cross-zone, ADR-047)
    const depots = await listDepots();
    const depotsById = new Map(depots.map((d) => [d.id, d]));
    // Si la ruta tiene override de depot, prepararlo para el optimizer.
    const vehicleDepotOverridesById = new Map<string, { lat: number; lng: number }>();
    if (route.depotOverrideId) {
      const ov = depotsById.get(route.depotOverrideId);
      if (ov) vehicleDepotOverridesById.set(vehicle.id, { lat: ov.lat, lng: ov.lng });
    }
    const optResponse = await callOptimizer([vehicle], stores, {
      shiftStartUnix,
      shiftEndUnix,
      shiftDate: route.date,
      timezone: TENANT_TIMEZONE,
      depotsById,
      vehicleDepotOverridesById,
    });
    const optRoute = optResponse.routes.find((r) => r.vehicle_id === 1);
    if (!optRoute || optRoute.steps.length === 0) {
      throw new ValidationError(
        'optimizer',
        'El optimizador no pudo asignar ninguna parada. Verifica capacidad del camión vs demanda total.',
      );
    }

    // Reset + re-insertar stops + marcar OPTIMIZED.
    // Orden importa: primero borramos stops (FK a route), luego reseteamos route.
    await deleteStopsForRoute(id);
    await resetRouteToDraft(id);

    const stopsToInsert = optRoute.steps.map((step, idx) => {
      const store = stores[step.job_id - 1];
      if (!store) throw new Error(`Optimizer devolvió job_id inválido: ${step.job_id}`);
      return {
        storeId: store.id,
        sequence: idx + 1,
        plannedArrivalAt: new Date(step.arrival * 1000).toISOString(),
        plannedDepartureAt: new Date(step.departure * 1000).toISOString(),
        load: step.load,
      };
    });

    // ADR-038: preservar las stops que el optimizer NO pudo asignar como pending
    // SIN ETA al final de la ruta. Antes (bug) las borrábamos — el dispatcher
    // perdía las paradas que había agregado manualmente. Ahora respetamos su
    // intención: la ruta queda con stops asignadas (con ETA) + stops manuales
    // (sin ETA). El chofer las atiende cuando llegue; o el dispatcher las mueve
    // a otra ruta si decide.
    const unassignedStoreIds = getUnassignedStoreIds(optResponse, stores);
    const unassignedStops = unassignedStoreIds.map((storeId, idx) => ({
      storeId,
      sequence: stopsToInsert.length + idx + 1,
      plannedArrivalAt: null,
      plannedDepartureAt: null,
      load: [] as number[],
    }));

    await createStops({ routeId: id, stops: [...stopsToInsert, ...unassignedStops] });

    const firstStep = optRoute.steps[0];
    const lastStep = optRoute.steps[optRoute.steps.length - 1];
    await markRouteOptimized(id, {
      totalDistanceMeters: optRoute.distance,
      totalDurationSeconds: optRoute.duration,
      estimatedStartAt: new Date((firstStep?.arrival ?? shiftStartUnix) * 1000).toISOString(),
      estimatedEndAt: new Date((lastStep?.departure ?? shiftEndUnix) * 1000).toISOString(),
    });

    revalidatePath('/routes');
    revalidatePath(`/routes/${id}`);

    return { ok: true, routeIds: [id], unassignedStoreIds };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}

export async function approveRouteAction(routeId: string): Promise<ActionResult> {
  const profile = await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    await approveRoute(id, profile.id);
    revalidatePath('/routes');
    revalidatePath(`/routes/${id}`);
  });
}

/**
 * Publica la ruta y dispara push notification al chofer asignado.
 * Si la ruta no tiene chofer, falla loud (no se puede publicar sin destinatario).
 */
export async function publishRouteAction(routeId: string): Promise<ActionResult> {
  const profile = await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    await publishRoute(id, profile.id);

    // C6 — push notification stub. Si el push falla (driver sin suscripción, VAPID
    // no configurado, etc.) NO revertimos la publicación: la ruta queda PUBLISHED
    // y el chofer puede verla cuando abra la app. El push es best-effort.
    await notifyDriverOfPublishedRoute(id).catch((err) => {
      console.warn(`[publishRoute] push falló (no crítico):`, err);
    });

    revalidatePath('/routes');
    revalidatePath(`/routes/${id}`);
  });
}

export async function cancelRouteAction(routeId: string): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    await cancelRoute(id);
    revalidatePath('/routes');
    revalidatePath(`/routes/${id}`);
  });
}

/**
 * Asigna o reasigna un chofer a una ruta. Solo válido en estados pre-publicación.
 */
export async function assignDriverAction(routeId: string, driverId: string | null): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    if (driverId) requireUuid('driverId', driverId);
    await assignDriverToRoute(id, driverId);
    revalidatePath(`/routes/${id}`);
  });
}

/**
 * ADR-047: setea o limpia el override de depot de salida para una ruta.
 * Pasar null = vuelve al depot del vehículo. Tras cambiar, recalcula métricas
 * (km/ETAs) para reflejar el nuevo origen. La revalidación incluye el detalle
 * del tiro porque el mapa multi-route también muestra el depot.
 */
export async function assignDepotToRouteAction(
  routeId: string,
  depotId: string | null,
): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    if (depotId) requireUuid('depotId', depotId);
    await assignDepotOverrideToRoute(id, depotId);
    // Las métricas dependen del depot — recalcular tras cualquier cambio.
    await recalculateRouteMetrics(id);
    const route = await getRoute(id);
    revalidatePath(`/routes/${id}`);
    if (route?.dispatchId) revalidatePath(`/dispatches/${route.dispatchId}`);
  });
}

export async function clearRouteStopsAction(routeId: string): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    await deleteStopsForRoute(id);
    revalidatePath(`/routes/${id}`);
  });
}

/**
 * Reordena las paradas de una ruta. ADR-035 (post-publicación reorder):
 *
 * - **Pre-publicación (DRAFT/OPTIMIZED/APPROVED):** reorder libre de TODAS las
 *   paradas. Métricas quedan obsoletas — UI sugiere re-optimizar.
 * - **Post-publicación (PUBLISHED/IN_PROGRESS):** reorder SOLO de paradas
 *   pendientes (las completed/arrived/skipped no se mueven — su sequence ya es
 *   historia). Bumpa version + audit en route_versions + push al chofer.
 * - **COMPLETED/CANCELLED/INTERRUPTED:** prohibido (ruta terminó).
 *
 * Las métricas (distance, duration, ETAs) NO se invalidan automáticamente —
 * el caller decide. Para post-publish, lo recomendado es NO re-optimizar
 * (rompería la confianza con el chofer); solo aceptar el orden que decidió
 * el admin/chofer y dejar que el chofer maneje la diferencia con su criterio.
 */
export async function reorderStopsAction(
  routeId: string,
  orderedStopIds: string[],
): Promise<ActionResult> {
  const profile = await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);

    const route = await getRoute(id);
    if (!route) throw new ValidationError('routeId', 'Ruta no existe');

    const PRE_PUBLISH = ['DRAFT', 'OPTIMIZED', 'APPROVED'] as const;
    const POST_PUBLISH = ['PUBLISHED', 'IN_PROGRESS'] as const;

    if (
      !PRE_PUBLISH.includes(route.status as (typeof PRE_PUBLISH)[number]) &&
      !POST_PUBLISH.includes(route.status as (typeof POST_PUBLISH)[number])
    ) {
      throw new ValidationError(
        'status',
        `No se puede reordenar una ruta en estado ${route.status}.`,
      );
    }
    const isPostPublish = POST_PUBLISH.includes(route.status as (typeof POST_PUBLISH)[number]);

    const current = await listStopsForRoute(id);

    if (isPostPublish) {
      // Solo paradas PENDING son reorderables. Las completed/arrived/skipped
      // mantienen su sequence original — son hechos consumados.
      const pending = current.filter((s) => s.status === 'pending');
      const nonPending = current
        .filter((s) => s.status !== 'pending')
        .sort((a, b) => a.sequence - b.sequence);
      const pendingIds = new Set(pending.map((s) => s.id));

      if (orderedStopIds.length !== pending.length) {
        throw new ValidationError(
          'orderedStopIds',
          `Solo paradas pendientes se pueden reordenar (esperadas ${pending.length}, recibidas ${orderedStopIds.length}).`,
        );
      }
      for (const stopId of orderedStopIds) {
        if (!pendingIds.has(stopId)) {
          throw new ValidationError(
            'orderedStopIds',
            `Stop ${stopId} no es una parada pendiente — no se puede mover.`,
          );
        }
      }

      // Construir orden final: histórico (no-pending) primero, después el nuevo
      // orden de pendientes. bulkReorderStops renumera secuencias de 1..N.
      const finalOrder = [...nonPending.map((s) => s.id), ...orderedStopIds];
      await bulkReorderStops(id, finalOrder);

      // Audit + push.
      try {
        await incrementRouteVersion(id, profile.id, `Admin reorder en ${route.status}`);
        await notifyDriverOfRouteChange(
          id,
          'Las paradas pendientes fueron reordenadas',
        );
      } catch (err) {
        // No revertir el reorder si falla el audit/push — son secundarios.
        console.error('[reorderStopsAction] post-publish audit/push falló:', err);
      }
    } else {
      // PRE-PUBLISH — comportamiento previo (reorder libre de TODAS).
      if (orderedStopIds.length !== current.length) {
        throw new ValidationError(
          'orderedStopIds',
          `Esperadas ${current.length} stops, recibidas ${orderedStopIds.length}`,
        );
      }
      const currentIds = new Set(current.map((s) => s.id));
      for (const stopId of orderedStopIds) {
        if (!currentIds.has(stopId)) {
          throw new ValidationError(
            'orderedStopIds',
            `Stop ${stopId} no pertenece a esta ruta`,
          );
        }
      }
      await bulkReorderStops(id, orderedStopIds);
    }

    revalidatePath(`/routes/${id}`);
    revalidatePath('/routes');
    revalidatePath('/dispatches');
  });
}

/**
 * Agrega una nueva parada a una ruta existente (ADR-036).
 * Solo permitido en DRAFT/OPTIMIZED/APPROVED — agregar paradas a una ruta
 * PUBLISHED+ requeriría re-optimizar y notificar al chofer (issue #66 abierto).
 */
export async function addStopToRouteAction(
  routeId: string,
  storeId: string,
): Promise<ActionResult & { stopId?: string; sequence?: number }> {
  await requireRole('admin', 'dispatcher');
  try {
    const id = requireUuid('routeId', routeId);
    requireUuid('storeId', storeId);

    const route = await getRoute(id);
    if (!route) return { ok: false, error: 'Ruta no existe' };

    if (!['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status)) {
      return {
        ok: false,
        error: `No se puede agregar paradas a una ruta en estado ${route.status}. Solo pre-publicación.`,
      };
    }

    // Validar que la tienda exista y sea de la misma zona que la ruta.
    const [store] = await getStoresByIds([storeId]);
    if (!store) return { ok: false, error: 'Tienda no encontrada' };
    if (store.zoneId !== route.zoneId) {
      return {
        ok: false,
        error: 'La tienda no pertenece a la misma zona que la ruta.',
      };
    }

    // Guard server-side: si la ruta tiene tiro, validar que la tienda no esté
    // ya en OTRA ruta viva del mismo tiro. Una tienda no puede recibir dos
    // entregas el mismo día desde el mismo tiro — para mover entre rutas
    // existe el flow "Mover a →" (moveStopToAnotherRouteAction).
    if (route.dispatchId) {
      const supabaseGuard = await (await import('@tripdrive/supabase/server')).createServerClient();
      // 1. Listar IDs de rutas vivas del tiro (excluyendo la actual).
      const { data: siblingRoutes, error: rErr } = await supabaseGuard
        .from('routes')
        .select('id, name')
        .eq('dispatch_id', route.dispatchId)
        .neq('status', 'CANCELLED')
        .neq('id', id);
      if (rErr) throw new Error(`[addStop] sibling routes: ${rErr.message}`);
      const siblingIds = (siblingRoutes ?? []).map((r) => r.id as string);

      if (siblingIds.length > 0) {
        // 2. Ver si la tienda ya está en alguna de esas rutas.
        const { data: dupes, error: dErr } = await supabaseGuard
          .from('stops')
          .select('route_id')
          .eq('store_id', storeId)
          .in('route_id', siblingIds);
        if (dErr) throw new Error(`[addStop] dupe check: ${dErr.message}`);

        const conflictStop = (dupes ?? [])[0];
        if (conflictStop) {
          const conflictRoute = (siblingRoutes ?? []).find(
            (r) => r.id === conflictStop.route_id,
          );
          return {
            ok: false,
            error: `${store.code} ya está en la ruta "${conflictRoute?.name ?? '?'}" del mismo tiro. Usa "Mover a →" para transferirla.`,
          };
        }
      }
    }

    const result = await appendStopToRoute(id, storeId);

    revalidatePath(`/routes/${id}`);
    revalidatePath('/routes');
    if (route.dispatchId) revalidatePath(`/dispatches/${route.dispatchId}`);
    return { ok: true, stopId: result.id, sequence: result.sequence };
  } catch (err) {
    if (err instanceof ValidationError) {
      return { ok: false, error: err.message, field: err.field };
    }
    return { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' };
  }
}

/**
 * Borra una parada de una ruta. Solo paradas pending (ADR-036).
 * Re-numera las paradas restantes para no dejar huecos en `sequence`.
 */
export async function deleteStopFromRouteAction(stopId: string): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('stopId', stopId);
    await deleteStopFromRoute(id);
    revalidatePath('/routes');
  });
}
