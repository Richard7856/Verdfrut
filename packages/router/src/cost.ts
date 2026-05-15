// Capa 4 del Optimization Engine — cálculo de costo MXN por ruta.
// ADR-100 / OE-2 / OPTIMIZATION_ENGINE.md líneas 191-219.
//
// Fórmula:
//   costo_MXN =
//     km_total * (cost_per_km_fuel + cost_per_km_wear)  +
//     hours_chofer_total * driver_hourly_wage           +
//     vehicle_count * dispatch_overhead
//
// Las constantes vienen de `customers.optimizer_costs jsonb` (migration
// 045). Si el customer no tiene la columna seteada, se usa DEFAULT_COSTS.
// Defensa adicional: el reader del JSONB merguea con DEFAULTS para no
// crashear si una key falta.

/** Configuración de costos por customer. Todas las cantidades en MXN. */
export interface OptimizerCostsConfig {
  /** Combustible por km. VerdFrut Kangoo 14 km/l: ~$2.5 con gasolina $35/L. */
  cost_per_km_fuel_mxn: number;
  /** Desgaste / mantenimiento / amortización por km. Estimado $0.5. */
  cost_per_km_wear_mxn: number;
  /** Salario chofer por hora. Chofer MX zona CDMX: ~$80/hr a $15k/mes 200 hrs. */
  driver_hourly_wage_mxn: number;
  /** Overhead fijo por despacho (admin, planificación). Default $50. */
  dispatch_overhead_mxn: number;
  /** Jornada máxima del chofer en horas (LFT MX = 9). Soft limit. */
  max_hours_per_driver: number;
  /** Tope operacional de stops por vehículo (heurística). */
  max_stops_per_vehicle: number;
}

export const DEFAULT_COSTS: OptimizerCostsConfig = {
  cost_per_km_fuel_mxn: 2.5,
  cost_per_km_wear_mxn: 0.5,
  driver_hourly_wage_mxn: 80,
  dispatch_overhead_mxn: 50,
  max_hours_per_driver: 9,
  max_stops_per_vehicle: 14,
};

/**
 * Merge un JSONB parcial con DEFAULT_COSTS. Defensa: keys faltantes o tipos
 * incorrectos caen al default. NO confiamos en que el JSONB venga bien
 * formado — un admin puede haber escrito basura via UI.
 */
export function parseCostsConfig(raw: unknown): OptimizerCostsConfig {
  if (!raw || typeof raw !== 'object') return DEFAULT_COSTS;
  const r = raw as Record<string, unknown>;

  const pick = (key: keyof OptimizerCostsConfig, min: number, max: number): number => {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max) return v;
    return DEFAULT_COSTS[key];
  };

  return {
    cost_per_km_fuel_mxn: pick('cost_per_km_fuel_mxn', 0, 100),
    cost_per_km_wear_mxn: pick('cost_per_km_wear_mxn', 0, 100),
    driver_hourly_wage_mxn: pick('driver_hourly_wage_mxn', 0, 10_000),
    dispatch_overhead_mxn: pick('dispatch_overhead_mxn', 0, 100_000),
    max_hours_per_driver: pick('max_hours_per_driver', 1, 24),
    max_stops_per_vehicle: pick('max_stops_per_vehicle', 1, 100),
  };
}

/** Métricas agregadas de un plan (suma de todas las rutas del plan). */
export interface PlanMetrics {
  totalKm: number;
  /** Horas-chofer totales (suma de duraciones de todas las rutas). */
  totalDriverHours: number;
  /** Cuántos vehículos están en uso en este plan. */
  vehicleCount: number;
  /** Hora máxima de un solo chofer (para feasibility check). */
  maxDriverHours: number;
}

/**
 * Calcula costo MXN de un plan completo dadas sus métricas y config.
 *
 * Redondeo: a 2 decimales (centavos). En MXN no hay subcentavos.
 */
export function computePlanCost(
  metrics: PlanMetrics,
  config: OptimizerCostsConfig,
): number {
  const fuel = metrics.totalKm * config.cost_per_km_fuel_mxn;
  const wear = metrics.totalKm * config.cost_per_km_wear_mxn;
  const labor = metrics.totalDriverHours * config.driver_hourly_wage_mxn;
  const overhead = metrics.vehicleCount * config.dispatch_overhead_mxn;
  const total = fuel + wear + labor + overhead;
  return Math.round(total * 100) / 100;
}

/** Breakdown granular del costo — útil para mostrar al user "$X combustible + $Y chofer + ...". */
export interface CostBreakdown {
  total_mxn: number;
  fuel_mxn: number;
  wear_mxn: number;
  labor_mxn: number;
  overhead_mxn: number;
}

export function computeCostBreakdown(
  metrics: PlanMetrics,
  config: OptimizerCostsConfig,
): CostBreakdown {
  const round = (n: number) => Math.round(n * 100) / 100;
  const fuel = round(metrics.totalKm * config.cost_per_km_fuel_mxn);
  const wear = round(metrics.totalKm * config.cost_per_km_wear_mxn);
  const labor = round(metrics.totalDriverHours * config.driver_hourly_wage_mxn);
  const overhead = round(metrics.vehicleCount * config.dispatch_overhead_mxn);
  return {
    total_mxn: round(fuel + wear + labor + overhead),
    fuel_mxn: fuel,
    wear_mxn: wear,
    labor_mxn: labor,
    overhead_mxn: overhead,
  };
}

/**
 * Determina si un plan es factible bajo los constraints del customer.
 * Hoy solo verifica jornada del chofer; en V1.1 agregar capacidad multi-dim
 * (peso/volumen/cajas).
 */
export function isPlanFeasible(metrics: PlanMetrics, config: OptimizerCostsConfig): boolean {
  return metrics.maxDriverHours <= config.max_hours_per_driver;
}
