// Public API del package @tripdrive/router.
// Capas 1+2 (ADR-097) + Capa 4 (ADR-100) del Optimization Engine.
// Capa 3 (secuencia intra-ruta) sigue en apps/platform via VROOM.

export { clusterStops, centroid } from './clustering';
export type { ClusterOptions } from './clustering';
export { assignClustersToVehicles } from './assignment';
export type {
  Cluster,
  Assignment,
  GeoPoint,
  RouterVehicle,
} from './types';
// Capa 4: cost + ranking.
export {
  DEFAULT_COSTS,
  parseCostsConfig,
  computePlanCost,
  computeCostBreakdown,
  isPlanFeasible,
} from './cost';
export type {
  OptimizerCostsConfig,
  PlanMetrics,
  CostBreakdown,
} from './cost';
export { rankAndPickAlternatives, computeKRange } from './propose';
export type { RoutePlanOption } from './propose';
