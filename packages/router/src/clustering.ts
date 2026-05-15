// Capa 1 del Optimization Engine — clustering geográfico.
// ADR-096 / OPTIMIZATION_ENGINE.md. Bisección recursiva por eje de mayor
// spread, splits en mediana. Determinístico, sin random seeds.
//
// Por qué bisección recursiva (no k-means):
//   1) Mismo input ⇒ mismo output (reproducible para el dispatcher).
//   2) Balance por construcción — mediana corta clusters de tamaño ≈ igual.
//   3) Ejes lat/lng alineados con grillas urbanas MX (Periférico, etc.).
//   4) Sin dependencias externas; ~80 líneas TS.

import type { Cluster, GeoPoint } from './types';

export interface ClusterOptions {
  /** Máx stops por cluster antes de forzar split (default: sin tope). */
  maxPerCluster?: number;
}

/**
 * Divide N stops en K clusters geográficamente coherentes.
 *
 * @param stops puntos a clusterizar (≥1)
 * @param k número de clusters deseado (≥1)
 * @returns array de exactamente min(k, stops.length) clusters
 *
 * Edge cases:
 *  - k=1: devuelve [stops] sin split.
 *  - stops.length ≤ k: cada stop se vuelve su propio cluster.
 *  - todos los puntos coinciden (spread=0): devuelve [stops] (no se puede
 *    dividir geográficamente; el caller debe overridear si necesita K>1).
 */
export function clusterStops<T extends GeoPoint>(
  stops: T[],
  k: number,
  options: ClusterOptions = {},
): Cluster<T>[] {
  if (stops.length === 0) return [];
  if (k < 1) throw new Error(`k debe ser ≥ 1, recibido ${k}`);

  const effectiveK = Math.min(k, stops.length);
  if (effectiveK === 1) return [stops];

  // Si todos los puntos están en el mismo lat/lng, la bisección por mediana
  // no puede separar. Devolver un solo cluster — el caller verá length=1
  // y puede decidir caer a otro algoritmo (round-robin, etc.).
  if (!hasGeographicSpread(stops)) return [stops];

  return bisect(stops, effectiveK, options.maxPerCluster);
}

function bisect<T extends GeoPoint>(
  stops: T[],
  k: number,
  maxPerCluster: number | undefined,
): Cluster<T>[] {
  // Caso base 1: un solo cluster pedido.
  if (k === 1) return [stops];

  // Caso base 2: ya cabemos bajo el límite y k no nos fuerza a más splits.
  if (maxPerCluster !== undefined && stops.length <= maxPerCluster && k === 1) {
    return [stops];
  }

  // Caso base 3: cada stop su propio cluster.
  if (stops.length <= k) return stops.map((s) => [s]);

  // Eje de split: el de mayor spread. Empate → lng (consistencia).
  const lngs = stops.map((s) => s.lng);
  const lats = stops.map((s) => s.lat);
  const lngSpread = Math.max(...lngs) - Math.min(...lngs);
  const latSpread = Math.max(...lats) - Math.min(...lats);
  const axis: 'lng' | 'lat' = lngSpread >= latSpread ? 'lng' : 'lat';

  // Sort por el eje + id como tie-breaker → determinístico aún con coordenadas
  // duplicadas. Sin tie-breaker, sorted() de stops idénticos puede variar entre
  // runs según el algoritmo de sort del runtime.
  const sorted = [...stops].sort((a, b) => {
    const diff = a[axis] - b[axis];
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Split en mediana por índice (no por valor) → garantiza balance exacto
  // incluso si muchos puntos comparten el valor mediano.
  const midIdx = Math.floor(sorted.length / 2);
  const left = sorted.slice(0, midIdx);
  const right = sorted.slice(midIdx);

  // Recursión: reparte k proporcional al tamaño de cada lado. floor/ceil
  // garantiza que kLeft + kRight === k.
  const kLeft = Math.floor(k / 2);
  const kRight = k - kLeft;

  return [
    ...bisect(left, kLeft, maxPerCluster),
    ...bisect(right, kRight, maxPerCluster),
  ];
}

function hasGeographicSpread(stops: GeoPoint[]): boolean {
  if (stops.length < 2) return false;
  const first = stops[0]!;
  return stops.some((s) => s.lat !== first.lat || s.lng !== first.lng);
}

/**
 * Centroide simple (media aritmética) de un cluster. Suficiente para
 * Capa 2 (asignación greedy). No es centroide geográfico real
 * (Mercator/ECEF), pero el error en una zona urbana <50km es despreciable.
 */
export function centroid(stops: GeoPoint[]): { lat: number; lng: number } {
  if (stops.length === 0) throw new Error('centroid: cluster vacío');
  let lat = 0;
  let lng = 0;
  for (const s of stops) {
    lat += s.lat;
    lng += s.lng;
  }
  return { lat: lat / stops.length, lng: lng / stops.length };
}
