// Pipeline del optimizer separado del side-effect de persistir.
// ADR-053: la operación "redistribuir un tiro" necesita una fase pura
// (calcular el plan via Railway) ANTES de tocar la BD. Si el optimizer falla,
// el tiro queda intacto. Esta separación habilita el patrón two-phase commit
// que la RPC `tripdrive_restructure_dispatch` espera.
//
// El módulo NO importa nada que toque BD por side-effect — todo lo que hace
// es leer entidades, llamar Railway, mapear el response.

import 'server-only';
import { localTimeToUnix } from '@tripdrive/utils';
import {
  clusterStops,
  assignClustersToVehicles,
  type RouterVehicle,
} from '@tripdrive/router';
import { callOptimizer, getUnassignedStoreIds } from './optimizer';
import { listDepots } from '@/lib/queries/depots';
import { getStoresByIds } from '@/lib/queries/stores';
import { getVehiclesByIds } from '@/lib/queries/vehicles';
import { getDriversByIds } from '@/lib/queries/drivers';

const TENANT_TIMEZONE = process.env.NEXT_PUBLIC_TENANT_TIMEZONE ?? 'America/Mexico_City';

export interface ComputePlanInput {
  /** Fecha operativa YYYY-MM-DD del tiro. */
  date: string;
  /** IDs de los vehículos involucrados — orden importa, define la posición de cada ruta. */
  vehicleIds: string[];
  /** Drivers por posición (paralelo a vehicleIds). null = sin asignar. */
  driverIds?: Array<string | null>;
  /** IDs de tiendas a distribuir. */
  storeIds: string[];
  /** Hora local del shift (HH:MM). Defaults sensatos. */
  shiftStart?: string;
  shiftEnd?: string;
  /**
   * ADR-047 / H3.3: override de depot por vehicle.id. Cuando el dispatcher
   * había seteado un CEDIS distinto al de la camioneta en la ruta anterior,
   * queremos preservarlo en la ruta nueva post-restructure.
   */
  vehicleDepotOverrides?: Map<string, string>;
  /** Prefijo del nombre de cada ruta — típicamente el nombre del dispatch. */
  routeNamePrefix: string;
}

export interface ComputedRoute {
  vehicleId: string;
  driverId: string | null;
  depotOverrideId: string | null;
  name: string;
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  estimatedStartAt: string; // ISO
  estimatedEndAt: string;   // ISO
  stops: Array<{
    storeId: string;
    sequence: number;
    plannedArrivalAt: string;
    plannedDepartureAt: string;
    load: number[];
  }>;
}

export interface OptimizationPlan {
  routes: ComputedRoute[];
  unassignedStoreIds: string[];
  /** Métricas agregadas — para H3.4 banner comparativo. */
  totalDistanceMeters: number;
  totalDurationSeconds: number;
}

/**
 * Carga entidades, valida zona, llama optimizer Railway, mapea el response a
 * un plan estructurado por ruta. NO toca BD para crear nada — solo lecturas.
 *
 * Si el optimizer falla, lanza error legible. El caller decide qué hacer
 * (mostrar al user, abortar el flujo, etc.) sin haber tocado las rutas existentes.
 */
export async function computeOptimizationPlan(
  input: ComputePlanInput,
): Promise<OptimizationPlan> {
  if (input.vehicleIds.length === 0) {
    throw new Error('Selecciona al menos un camión');
  }
  if (input.storeIds.length === 0) {
    throw new Error('Selecciona al menos una tienda');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('Fecha debe ser YYYY-MM-DD');
  }
  if (input.driverIds && input.driverIds.length !== input.vehicleIds.length) {
    throw new Error('driverIds debe tener la misma longitud que vehicleIds');
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

  // 2. Validar misma zona.
  const zoneId = vehicles[0]?.zoneId;
  if (!zoneId) throw new Error('No se pudo determinar la zona del camión');
  if (!vehicles.every((v) => v.zoneId === zoneId)) {
    throw new Error('Todos los camiones deben pertenecer a la misma zona');
  }
  if (!stores.every((s) => s.zoneId === zoneId)) {
    throw new Error('Todas las tiendas deben pertenecer a la misma zona que los camiones');
  }
  if (drivers.length > 0 && !drivers.every((d) => d.zoneId === zoneId)) {
    throw new Error('Todos los choferes asignados deben pertenecer a la misma zona');
  }

  // 3. Shift window.
  const shiftStart = input.shiftStart ?? '06:00';
  const shiftEnd = input.shiftEnd ?? '14:00';
  const shiftStartUnix = localTimeToUnix(input.date, shiftStart, TENANT_TIMEZONE);
  const shiftEndUnix = localTimeToUnix(input.date, shiftEnd, TENANT_TIMEZONE);
  if (shiftEndUnix <= shiftStartUnix) {
    throw new Error('El fin del turno debe ser posterior al inicio');
  }

  // 4. Depots — incluir TODOS los disponibles para que cross-zone overrides
  // (ADR-047) puedan resolver. El filtro por zona se queda en zoneId solo
  // para los vehículos, no para los depots.
  const depots = await listDepots();
  const depotsById = new Map(depots.map((d) => [d.id, d]));

  // 5. Convertir overrides de vehicleId → depotId a vehicleId → {lat,lng}
  // que el optimizer espera.
  const vehicleDepotOverridesById = new Map<string, { lat: number; lng: number }>();
  if (input.vehicleDepotOverrides) {
    for (const [vehicleId, depotId] of input.vehicleDepotOverrides.entries()) {
      const d = depotsById.get(depotId);
      if (d) vehicleDepotOverridesById.set(vehicleId, { lat: d.lat, lng: d.lng });
    }
  }

  // 6. Resolver customer_id para el cache de matriz (OE-4a). Los vehículos
  // de un mismo plan siempre pertenecen al mismo customer (validado upstream
  // por RLS y zone consistency). Si la query falla, dejamos undefined → el
  // optimizer corre sin cache (legacy path).
  let customerId: string | undefined;
  try {
    const { createServiceRoleClient } = await import('@tripdrive/supabase/server');
    const admin = createServiceRoleClient();
    const { data: vehicleRow } = await admin
      .from('vehicles')
      .select('customer_id')
      .eq('id', vehicles[0]!.id)
      .maybeSingle();
    customerId = (vehicleRow?.customer_id as string | undefined) ?? undefined;
  } catch {
    /* no-op: cache opcional, fallback a fresh fetch */
  }

  // 7. Optimizer call.
  const optResponse = await callOptimizer(vehicles, stores, {
    shiftStartUnix,
    shiftEndUnix,
    shiftDate: input.date,
    timezone: TENANT_TIMEZONE,
    depotsById,
    vehicleDepotOverridesById,
    customerId,
  });

  // 8. Mapear respuesta a plan estructurado.
  const computedRoutes: ComputedRoute[] = [];
  let totalDistance = 0;
  let totalDuration = 0;
  for (let i = 0; i < vehicles.length; i++) {
    const vehicle = vehicles[i];
    if (!vehicle) continue;
    const optRoute = optResponse.routes.find((r) => r.vehicle_id === i + 1);
    if (!optRoute || optRoute.steps.length === 0) {
      // Vehículo sin asignaciones — se omite (no crea ruta vacía).
      continue;
    }
    const driverIdForVehicle = input.driverIds?.[i] ?? null;
    const depotOverrideId = input.vehicleDepotOverrides?.get(vehicle.id) ?? null;
    const firstStep = optRoute.steps[0]!;
    const lastStep = optRoute.steps[optRoute.steps.length - 1]!;
    computedRoutes.push({
      vehicleId: vehicle.id,
      driverId: driverIdForVehicle,
      depotOverrideId,
      name: `${input.routeNamePrefix} — ${vehicle.alias ?? vehicle.plate}`,
      totalDistanceMeters: optRoute.distance,
      totalDurationSeconds: optRoute.duration,
      estimatedStartAt: new Date(firstStep.arrival * 1000).toISOString(),
      estimatedEndAt: new Date(lastStep.departure * 1000).toISOString(),
      stops: optRoute.steps.map((step, idx) => {
        const store = stores[step.job_id - 1];
        if (!store) throw new Error(`Optimizer devolvió job_id inválido: ${step.job_id}`);
        return {
          storeId: store.id,
          sequence: idx + 1,
          plannedArrivalAt: new Date(step.arrival * 1000).toISOString(),
          plannedDepartureAt: new Date(step.departure * 1000).toISOString(),
          load: step.load,
        };
      }),
    });
    totalDistance += optRoute.distance;
    totalDuration += optRoute.duration;
  }

  const unassignedStoreIds = getUnassignedStoreIds(optResponse, stores);

  return {
    routes: computedRoutes,
    unassignedStoreIds,
    totalDistanceMeters: totalDistance,
    totalDurationSeconds: totalDuration,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Capa 1+2 del Optimization Engine (ADR-096 / OPTIMIZATION_ENGINE.md)
// Pre-clustering geográfico antes de invocar VROOM.
// ─────────────────────────────────────────────────────────────────────

/**
 * Variante con pre-clustering geográfico. Aplica capas 1+2 de
 * @tripdrive/router (split por bisección + asignación greedy al depot más
 * cercano) y luego ejecuta `computeOptimizationPlan` UNA VEZ POR VEHÍCULO
 * en paralelo con su subconjunto pre-asignado de stops.
 *
 * Por qué llamar VROOM N veces en lugar de 1 sola:
 *   VROOM resuelve secuencia dado un set de stops por vehículo — pero
 *   cuando le pasamos todos los vehículos juntos, su asignación tiende a
 *   "vaciar primero al primer vehículo" sin optimizar globalmente la
 *   distribución geográfica. El clustering previo fuerza la separación
 *   por zonas coherentes (evidencia VerdFrut sur CDMX: -40% km totales).
 *
 * Trade-off conocido: las N llamadas a VROOM corren en paralelo
 * (Promise.all) → latencia agregada ≈ max(latencias) en lugar de suma.
 * Sin embargo, cada call paga su propia matriz de tráfico (Google Routes),
 * lo que multiplica el costo de API. Mitigación pendiente Sprint 4: cache
 * de matriz pre-clustering.
 *
 * Backward compatible: el flujo legacy sigue usando `computeOptimizationPlan`.
 * Sólo callers nuevos (orchestrator AI, propose_route_plan) usan esta variante.
 */
export async function computeClusteredOptimizationPlan(
  input: ComputePlanInput,
): Promise<OptimizationPlan> {
  if (input.vehicleIds.length === 0) {
    throw new Error('Selecciona al menos un camión');
  }
  if (input.storeIds.length === 0) {
    throw new Error('Selecciona al menos una tienda');
  }

  // Cargar entidades para conocer coords + depots — el clustering necesita
  // lat/lng. Mismas queries que la versión legacy, sin tocar BD por side-effect.
  const [stores, vehicles] = await Promise.all([
    getStoresByIds(input.storeIds),
    getVehiclesByIds(input.vehicleIds),
  ]);
  if (stores.length !== input.storeIds.length) throw new Error('Alguna tienda no existe');
  if (vehicles.length !== input.vehicleIds.length) throw new Error('Algún camión no existe');

  // Resolver depot por vehículo: override > depot_id de la tabla > coords
  // crudas del vehículo. El clustering usa coords; si un vehículo no las
  // tiene en ninguna fuente, cae al centroide de los stops (sentinel).
  const depots = await listDepots();
  const depotsById = new Map(depots.map((d) => [d.id, d]));

  const routerVehicles: RouterVehicle[] = vehicles.map((v) => {
    const overrideId = input.vehicleDepotOverrides?.get(v.id);
    if (overrideId) {
      const d = depotsById.get(overrideId);
      if (d) return { id: v.id, depot: { lat: d.lat, lng: d.lng } };
    }
    if (v.depotId) {
      const d = depotsById.get(v.depotId);
      if (d) return { id: v.id, depot: { lat: d.lat, lng: d.lng } };
    }
    if (v.depotLat !== null && v.depotLng !== null) {
      return { id: v.id, depot: { lat: v.depotLat, lng: v.depotLng } };
    }
    // Sentinel: si no hay depot, usar (0,0). El greedy degenera al orden
    // del array. Caso muy raro en producción (vehículos están saneados).
    return { id: v.id, depot: { lat: 0, lng: 0 } };
  });

  // Capa 1: clustering.
  const k = vehicles.length;
  const clusters = clusterStops(
    stores.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
    k,
  );

  // Si el clustering devuelve menos clusters que k (ej. todos los stops
  // colocan en el mismo punto), caemos al pipeline legacy: un solo VROOM
  // con todos los vehículos resuelve mejor que llamarlo N veces con el mismo
  // conjunto duplicado.
  if (clusters.length < k) {
    return computeOptimizationPlan(input);
  }

  // Capa 2: asignación cluster → vehicle.
  const assignment = assignClustersToVehicles(clusters, routerVehicles);

  // Construir un sub-input por vehículo y disparar VROOM en paralelo.
  // Cada sub-input preserva driverId y depotOverride correspondiente.
  const driverByVehicleId = new Map<string, string | null>();
  input.vehicleIds.forEach((vid, i) => {
    driverByVehicleId.set(vid, input.driverIds?.[i] ?? null);
  });

  const subPlans = await Promise.all(
    [...assignment.entries()].map(([vehicleId, clusterStops]) => {
      const subInput: ComputePlanInput = {
        ...input,
        vehicleIds: [vehicleId],
        driverIds: [driverByVehicleId.get(vehicleId) ?? null],
        storeIds: clusterStops.map((s) => s.id),
      };
      return computeOptimizationPlan(subInput);
    }),
  );

  // Mergear resultados. Las rutas mantienen su orden de aparición — irrelevante
  // funcionalmente porque cada ruta tiene su vehicleId asignado.
  const mergedRoutes: ComputedRoute[] = [];
  let mergedDistance = 0;
  let mergedDuration = 0;
  const mergedUnassigned: string[] = [];
  for (const p of subPlans) {
    mergedRoutes.push(...p.routes);
    mergedDistance += p.totalDistanceMeters;
    mergedDuration += p.totalDurationSeconds;
    mergedUnassigned.push(...p.unassignedStoreIds);
  }

  return {
    routes: mergedRoutes,
    unassignedStoreIds: mergedUnassigned,
    totalDistanceMeters: mergedDistance,
    totalDurationSeconds: mergedDuration,
  };
}
