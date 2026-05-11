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

  // 6. Optimizer call.
  const optResponse = await callOptimizer(vehicles, stores, {
    shiftStartUnix,
    shiftEndUnix,
    shiftDate: input.date,
    timezone: TENANT_TIMEZONE,
    depotsById,
    vehicleDepotOverridesById,
  });

  // 7. Mapear respuesta a plan estructurado.
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
