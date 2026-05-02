'use server';

// Server Actions del flujo de rutas.
// La acción crítica es createAndOptimizeRoute: orquesta queries + optimizer en una transacción lógica.

import { revalidatePath } from 'next/cache';
import { localTimeToUnix } from '@verdfrut/utils';
import { requireRole } from '@/lib/auth';
import {
  createDraftRoute,
  getRoute,
  markRouteOptimized,
  approveRoute,
  publishRoute,
  cancelRoute,
  assignDriverToRoute,
  resetRouteToDraft,
} from '@/lib/queries/routes';
import {
  bulkReorderStops,
  createStops,
  deleteStopsForRoute,
  listStopsForRoute,
} from '@/lib/queries/stops';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDriversByIds } from '@/lib/queries/drivers';
import { listDepots } from '@/lib/queries/depots';
import { callOptimizer, getUnassignedStoreIds } from '@/lib/optimizer';
import { notifyDriverOfPublishedRoute } from '@/lib/push';
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
}

export interface CreateAndOptimizeResult {
  ok: boolean;
  error?: string;
  routeIds?: string[];
  unassignedStoreIds?: string[];
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

    return { ok: true, routeIds: createdRouteIds, unassignedStoreIds };
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

    // Llamar al optimizer (con depots de la zona)
    const depots = await listDepots({ zoneId: vehicle.zoneId });
    const depotsById = new Map(depots.map((d) => [d.id, d]));
    const optResponse = await callOptimizer([vehicle], stores, {
      shiftStartUnix,
      shiftEndUnix,
      shiftDate: route.date,
      timezone: TENANT_TIMEZONE,
      depotsById,
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
    await createStops({ routeId: id, stops: stopsToInsert });

    const firstStep = optRoute.steps[0];
    const lastStep = optRoute.steps[optRoute.steps.length - 1];
    await markRouteOptimized(id, {
      totalDistanceMeters: optRoute.distance,
      totalDurationSeconds: optRoute.duration,
      estimatedStartAt: new Date((firstStep?.arrival ?? shiftStartUnix) * 1000).toISOString(),
      estimatedEndAt: new Date((lastStep?.departure ?? shiftEndUnix) * 1000).toISOString(),
    });

    const unassignedStoreIds = getUnassignedStoreIds(optResponse, stores);

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

export async function clearRouteStopsAction(routeId: string): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);
    await deleteStopsForRoute(id);
    revalidatePath(`/routes/${id}`);
  });
}

/**
 * Reordena las paradas de una ruta. Solo permitido si la ruta NO está
 * publicada (DRAFT/OPTIMIZED/APPROVED). Una vez PUBLISHED, modificar paradas
 * implicaría notificar al chofer y crear nueva versión — flujo separado.
 *
 * Las métricas de la ruta (distance, duration, ETAs) quedan obsoletas tras
 * el reorder. La UI debe mostrar un warning sugiriendo re-optimizar para
 * recomputarlas, pero NO se invalidan automáticamente — el dispatcher decide.
 */
export async function reorderStopsAction(
  routeId: string,
  orderedStopIds: string[],
): Promise<ActionResult> {
  await requireRole('admin', 'dispatcher');
  return runAction(async () => {
    const id = requireUuid('routeId', routeId);

    const route = await getRoute(id);
    if (!route) throw new ValidationError('routeId', 'Ruta no existe');
    if (!['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status)) {
      throw new ValidationError(
        'status',
        `No se puede reordenar una ruta en estado ${route.status}. Solo DRAFT/OPTIMIZED/APPROVED.`,
      );
    }

    // Validar que orderedStopIds tenga TODAS las stops actuales (no parcial).
    const current = await listStopsForRoute(id);
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

    revalidatePath(`/routes/${id}`);
    revalidatePath('/routes');
  });
}
