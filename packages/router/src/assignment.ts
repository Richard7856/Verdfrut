// Capa 2 del Optimization Engine — asignación cluster → vehículo.
// ADR-096. Greedy: para cada cluster, busca el vehículo libre cuyo depot
// minimiza la distancia al centroide del cluster.
//
// Determinismo: la iteración recorre los clusters en el orden de entrada
// (que ya viene determinístico desde clusterStops). En empates de distancia
// el primer vehículo del array gana — el caller controla el orden.
//
// Caso degenerado VerdFrut V1: todos los vehículos comparten depot (CEDA).
// Resultado: el "más cercano" es ambiguo, la asignación cae a "primer
// vehículo en la lista de remaining". Aceptable porque la secuencia
// intra-ruta (Capa 3, VROOM) la define el dispatcher de todas formas.

import { haversineMeters } from '@tripdrive/utils/gps';
import { centroid } from './clustering';
import type { Assignment, Cluster, GeoPoint, RouterVehicle } from './types';

/**
 * Asigna cada cluster a un vehículo distinto.
 *
 * @throws si clusters.length > vehicles.length (no se puede asignar).
 *
 * @returns Map<vehicleId, stops>. Vehículos sin cluster asignado NO aparecen
 *          en el map (el caller los trata como "no usado en este tiro").
 */
export function assignClustersToVehicles<T extends GeoPoint>(
  clusters: Cluster<T>[],
  vehicles: RouterVehicle[],
): Assignment<T> {
  if (clusters.length > vehicles.length) {
    throw new Error(
      `assignClustersToVehicles: hay ${clusters.length} clusters pero solo ` +
        `${vehicles.length} vehículos disponibles`,
    );
  }

  const assignments: Assignment<T> = new Map();
  const remaining: RouterVehicle[] = [...vehicles];

  for (const cluster of clusters) {
    if (cluster.length === 0) continue;
    const c = centroid(cluster);

    // Elegir el vehículo cuyo depot esté más cerca del centroide.
    // En empate, gana el primero (orden de aparición en `remaining`).
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const v = remaining[i]!;
      const d = haversineMeters(c.lat, c.lng, v.depot.lat, v.depot.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    const chosen = remaining[bestIdx]!;
    assignments.set(chosen.id, cluster);
    remaining.splice(bestIdx, 1);
  }

  return assignments;
}
