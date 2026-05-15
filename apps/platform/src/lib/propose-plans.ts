// Orquestación de la Capa 4 del Optimization Engine.
// ADR-100 / OE-2. Llamado por /api/orchestrator/internal/propose-routes.
//
// Vive en apps/platform (no en @tripdrive/router) porque necesita acceso
// a BD (stores, vehicles, customer config) y al optimizer Railway (VROOM).
// El package de router solo expone lógica pura (cost, ranking).
//
// Flujo:
//   1. Resolver customer_id + costs config desde BD.
//   2. Determinar [minK, maxK] de vehículos a explorar.
//   3. Por cada K en paralelo: clusterizar + VROOM por cluster + métricas + costo.
//   4. Filtrar infactibles, rankear, devolver hasta 3 representativas.
//
// No persiste nada — la materialización es responsabilidad de
// `apply_route_plan` (Sprint OE-3).

import 'server-only';
import {
  computeKRange,
  rankAndPickAlternatives,
  parseCostsConfig,
  computeCostBreakdown,
  type RoutePlanOption,
  type OptimizerCostsConfig,
  type PlanMetrics,
} from '@tripdrive/router';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import {
  computeClusteredOptimizationPlan,
  type OptimizationPlan,
} from './optimizer-pipeline';

export interface ProposePlansInput {
  /** customer_id derivado server-side (NUNCA del body — hardening C1). */
  customerId: string;
  /** Fecha operativa YYYY-MM-DD. */
  date: string;
  /** IDs de stops a distribuir (≥1). */
  storeIds: string[];
  /** IDs de vehículos disponibles (≥1). Pueden ser de cualquier zona compartida. */
  availableVehicleIds: string[];
  /** Hora local del shift. Defaults sensatos del pipeline (06:00-14:00). */
  shiftStart?: string;
  shiftEnd?: string;
  /** Nombre base para las rutas previstas (display only). */
  routeNamePrefix?: string;
}

export interface ProposePlansOutput {
  /** Hasta 3 alternativas rankeadas (cheapest, balanced, fastest). */
  alternatives: RoutePlanOption[];
  /** Config de costos usada (post merge con defaults — útil para mostrar al user). */
  costsConfig: OptimizerCostsConfig;
  /** Rango K explorado. */
  kExplored: { minK: number; maxK: number };
  /** Si maxK === minK y solo se computó 1 opción, esto lo refleja. */
  singleOptionMode: boolean;
  /** Cuántas opciones se evaluaron antes del filter de feasibility/ranking. */
  totalEvaluated: number;
  /** Stops que el optimizer no pudo asignar en NINGUNA opción (raro, suele ser
   *  por ventanas horarias imposibles). El user debe revisar antes de aplicar. */
  alwaysUnassignedStoreIds: string[];
}

/**
 * Calcula 2-3 alternativas de plan para un set de stops + vehículos.
 *
 * Errores no se silencian: si un K particular falla en VROOM, esa opción
 * se omite pero las demás siguen. Si TODAS fallan, throw.
 */
export async function proposePlans(input: ProposePlansInput): Promise<ProposePlansOutput> {
  if (input.storeIds.length === 0) throw new Error('storeIds vacío');
  if (input.availableVehicleIds.length === 0) throw new Error('availableVehicleIds vacío');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('date debe ser YYYY-MM-DD');

  // 1. Cargar config de costos del customer.
  const admin = createServiceRoleClient();
  const { data: customer } = await admin
    .from('customers')
    .select('optimizer_costs')
    .eq('id', input.customerId)
    .maybeSingle();
  const costsConfig = parseCostsConfig((customer as { optimizer_costs?: unknown } | null)?.optimizer_costs);

  // 2. Determinar rango K.
  const { minK, maxK } = computeKRange(
    input.storeIds.length,
    input.availableVehicleIds.length,
    costsConfig,
  );

  if (maxK < minK) {
    throw new Error(
      `Configuración imposible: ${input.storeIds.length} stops requieren al menos ${minK} vehículos pero solo hay ${input.availableVehicleIds.length} disponibles.`,
    );
  }

  // 3. Computar plan por cada K en paralelo. Cada plan llama VROOM N veces
  // (una por cluster) — si tenemos K=2 y K=3 paralelos, son hasta 5 calls
  // simultáneas. Eso es OK; el optimizer Railway aguanta.
  const ks: number[] = [];
  for (let k = minK; k <= maxK; k++) ks.push(k);

  const results = await Promise.allSettled(
    ks.map((k) =>
      computeClusteredOptimizationPlan({
        date: input.date,
        vehicleIds: input.availableVehicleIds.slice(0, k),
        driverIds: Array.from({ length: k }, () => null),
        storeIds: input.storeIds,
        shiftStart: input.shiftStart,
        shiftEnd: input.shiftEnd,
        routeNamePrefix: input.routeNamePrefix ?? `Plan K=${k}`,
      }).then((plan) => ({ k, plan })),
    ),
  );

  // 4. Convertir cada plan a RoutePlanOption (sin labels).
  type RawOption = Omit<RoutePlanOption, 'labels'>;
  const rawOptions: RawOption[] = [];
  const failures: string[] = [];
  // Stops unassigned por opción — para detectar "siempre unassigned".
  const unassignedByK: Array<{ k: number; ids: string[] }> = [];

  for (const settled of results) {
    if (settled.status === 'rejected') {
      failures.push(settled.reason instanceof Error ? settled.reason.message : String(settled.reason));
      continue;
    }
    const { k, plan } = settled.value;
    rawOptions.push(planToOption(k, plan, costsConfig));
    unassignedByK.push({ k, ids: plan.unassignedStoreIds });
  }

  if (rawOptions.length === 0) {
    throw new Error(
      `Ninguna alternativa pudo computarse. Errores: ${failures.join(' | ') || 'desconocido'}`,
    );
  }

  // 5. Rankear con labels.
  const ranked = rankAndPickAlternatives(rawOptions, costsConfig);

  // 6. Identificar stops "siempre unassigned" — intersección de unassigned de
  // TODAS las opciones evaluadas. Si un stop nunca se pudo rutear, hay algo
  // estructural (ventana horaria imposible, coord en mar, etc.).
  let alwaysUnassigned: Set<string>;
  if (unassignedByK.length === 0) {
    alwaysUnassigned = new Set();
  } else {
    alwaysUnassigned = new Set(unassignedByK[0]!.ids);
    for (let i = 1; i < unassignedByK.length; i++) {
      const next = new Set(unassignedByK[i]!.ids);
      alwaysUnassigned = new Set([...alwaysUnassigned].filter((id) => next.has(id)));
    }
  }

  return {
    alternatives: ranked,
    costsConfig,
    kExplored: { minK, maxK },
    singleOptionMode: maxK === minK,
    totalEvaluated: rawOptions.length,
    alwaysUnassignedStoreIds: [...alwaysUnassigned],
  };
}

/**
 * Convierte un OptimizationPlan en un RoutePlanOption (sin labels).
 * Cómputo de métricas y costo se hace aquí — el ranking puro queda en el
 * package router.
 */
function planToOption(
  k: number,
  plan: OptimizationPlan,
  config: OptimizerCostsConfig,
): Omit<RoutePlanOption, 'labels'> {
  const totalKm = plan.totalDistanceMeters / 1000;
  const totalHours = plan.totalDurationSeconds / 3600;
  // Hora del chofer más cargado — usado para feasibility (jornada legal).
  const maxDriverHours = plan.routes.reduce(
    (mx, r) => Math.max(mx, r.totalDurationSeconds / 3600),
    0,
  );

  const metrics: PlanMetrics = {
    totalKm,
    totalDriverHours: totalHours,
    vehicleCount: plan.routes.length, // solo cuenta los vehículos que SÍ tuvieron stops asignados
    maxDriverHours,
  };

  return {
    id: `K${k}`,
    vehicleCount: plan.routes.length,
    metrics,
    cost: computeCostBreakdown(metrics, config),
    feasible: maxDriverHours <= config.max_hours_per_driver,
    routes: plan.routes.map((r) => ({
      vehicleId: r.vehicleId,
      driverId: r.driverId,
      stopCount: r.stops.length,
      distanceKm: r.totalDistanceMeters / 1000,
      durationHours: r.totalDurationSeconds / 3600,
    })),
  };
}
