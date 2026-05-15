// Capa 4 — ranking de alternativas y picking de las 3 representativas.
// ADR-100 / OE-2 / OPTIMIZATION_ENGINE.md líneas 249-258.
//
// Decisión arquitectónica: el cómputo real (clustering + VROOM por K) se
// hace en `apps/platform/src/lib/propose-plans.ts` que tiene acceso a BD
// y al optimizer Railway. Este módulo solo recibe las opciones ya
// computadas y las clasifica en 3 categorías legibles para el user.

import type { CostBreakdown, OptimizerCostsConfig, PlanMetrics } from './cost';
import { computeCostBreakdown, isPlanFeasible } from './cost';

/** Una alternativa de plan, lista para presentar al user. */
export interface RoutePlanOption {
  /** Identificador interno (para que el orchestrator referencie luego). */
  id: string;
  vehicleCount: number;
  metrics: PlanMetrics;
  cost: CostBreakdown;
  feasible: boolean;
  /**
   * Etiqueta humana asignada por el ranking. Una opción puede tener varias
   * (la económica también puede ser la balanced si coincide).
   */
  labels: ReadonlyArray<'cheapest' | 'balanced' | 'fastest'>;
  /**
   * Detalle por ruta — el caller lo embebe para que la UI muestre breakdown
   * por camioneta. No lo usa el ranking.
   */
  routes: ReadonlyArray<{
    vehicleId: string;
    driverId: string | null;
    stopCount: number;
    distanceKm: number;
    durationHours: number;
  }>;
}

/**
 * Ordena y etiqueta las opciones. Devuelve hasta 3 alternativas
 * representativas (la spec dice no más, para no espamear al dispatcher).
 *
 * Reglas (OPTIMIZATION_ENGINE.md líneas 252-256):
 *   1. CHEAPEST: menor `total_mxn`.
 *   2. BALANCED: jornada del chofer más cargado ≤ 7h, costo razonable.
 *      Si ninguna cumple, omitir esta categoría.
 *   3. FASTEST: menor `maxDriverHours` (entrega total más temprano).
 *
 * Si dos categorías coinciden en la misma opción (común con pocos vehículos),
 * la opción aparece UNA SOLA VEZ con ambos labels.
 */
export function rankAndPickAlternatives(
  options: ReadonlyArray<Omit<RoutePlanOption, 'labels'>>,
  costsConfig: OptimizerCostsConfig,
): RoutePlanOption[] {
  if (options.length === 0) return [];

  // Filtrar infactibles ANTES de rankear.
  const feasible = options.filter((o) => isPlanFeasible(o.metrics, costsConfig));
  if (feasible.length === 0) {
    // Edge case: nada factible. Devolvemos la "menos mala" para que el user
    // al menos vea por qué (puede aflojar constraints).
    const leastBad = [...options].sort((a, b) => a.metrics.maxDriverHours - b.metrics.maxDriverHours)[0]!;
    return [{ ...leastBad, labels: [] }];
  }

  // 1. CHEAPEST: menor costo total.
  const cheapest = [...feasible].sort((a, b) => a.cost.total_mxn - b.cost.total_mxn)[0]!;

  // 2. BALANCED: jornada cómoda. Umbral 7h del spec.
  const balancedCandidates = feasible.filter((o) => o.metrics.maxDriverHours <= 7);
  // De los candidatos, el más barato.
  const balanced =
    balancedCandidates.length > 0
      ? [...balancedCandidates].sort((a, b) => a.cost.total_mxn - b.cost.total_mxn)[0]!
      : null;

  // 3. FASTEST: menor maxDriverHours (entrega completa más temprano).
  const fastest = [...feasible].sort((a, b) => a.metrics.maxDriverHours - b.metrics.maxDriverHours)[0]!;

  // Mergear: misma opción con múltiples labels.
  const optionsByIdLabels = new Map<string, RoutePlanOption['labels']>();
  function tag(opt: Omit<RoutePlanOption, 'labels'>, label: 'cheapest' | 'balanced' | 'fastest'): void {
    const existing = optionsByIdLabels.get(opt.id) ?? [];
    if (!existing.includes(label)) optionsByIdLabels.set(opt.id, [...existing, label]);
  }
  tag(cheapest, 'cheapest');
  if (balanced) tag(balanced, 'balanced');
  tag(fastest, 'fastest');

  // Construir resultado en orden de presentación (cheapest, balanced, fastest).
  const seen = new Set<string>();
  const result: RoutePlanOption[] = [];
  const order: Array<Omit<RoutePlanOption, 'labels'>> = balanced
    ? [cheapest, balanced, fastest]
    : [cheapest, fastest];

  for (const opt of order) {
    if (seen.has(opt.id)) continue;
    seen.add(opt.id);
    result.push({
      ...opt,
      labels: optionsByIdLabels.get(opt.id) ?? [],
    });
  }

  return result;
}

/**
 * Determina el rango de K (número de vehículos) a explorar dado el set de
 * stops y constraints. Devuelve [minK, maxK] inclusivo.
 *
 * minK = ceil(stops / maxStopsPerVehicle) — debajo de esto un solo
 *        vehículo se satura.
 * maxK = min(vehiclesAvailable, floor(stops / 4)) — usar más vehículos
 *        que 1 cada 4 stops es ridículo (cada camioneta haría 3-4 paradas).
 */
export function computeKRange(
  stopCount: number,
  vehiclesAvailable: number,
  config: OptimizerCostsConfig,
): { minK: number; maxK: number } {
  const minK = Math.max(1, Math.ceil(stopCount / config.max_stops_per_vehicle));
  const maxK = Math.max(
    minK,
    Math.min(vehiclesAvailable, Math.floor(stopCount / 4)),
  );
  return { minK, maxK };
}
