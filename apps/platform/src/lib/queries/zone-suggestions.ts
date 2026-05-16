import 'server-only';

// Sugerencia de partición de zona (Workbench WB-3 / ADR-115).
//
// Toma una zona existente con sus tiendas activas, las clusteriza con la
// función bisection del package @tripdrive/router, y enriquece cada cluster
// con frecuencia/kg/sem agregada (WB-2). El admin ve la propuesta side-by-side
// con métricas para decidir si vale la pena partir.
//
// Diseño:
//   - Reusa clusterStops del router package — mismo algoritmo que el
//     Optimization Engine en producción, así el preview refleja lo que el
//     optimizer haría en la operación real.
//   - Enriquece con stats WB-2: por cada cluster acumula visitas/sem y kg/sem
//     totales para que el admin entienda balance de carga (no solo balance
//     de conteo de tiendas).
//   - Pure read-only — NO escribe nada a BD. Acción de commit ("crear N
//     zonas hipotéticas con esta propuesta") queda diferida a WB-3b.

import { clusterStops, centroid } from '@tripdrive/router';
import { createServerClient } from '@tripdrive/supabase/server';
import { getStoreFrequencyStats } from './store-frequencies';

export interface ProposedClusterStore {
  id: string;
  code: string;
  name: string;
  lat: number;
  lng: number;
  visitsPerWeek: number;
  kgPerVisit: number | null;
  kgPerWeek: number;
}

export interface ProposedCluster {
  /** Index 1-based (1, 2, 3…) — útil para etiquetas "Sub-zona 1". */
  index: number;
  /** Color hex sugerido para la UI (paleta consistente con rutas). */
  color: string;
  stores: ProposedClusterStore[];
  centroid: { lat: number; lng: number };
  storeCount: number;
  totalVisitsPerWeek: number;
  totalKgPerWeek: number;
}

export interface ZoneSuggestion {
  zoneId: string;
  zoneName: string;
  zoneCode: string;
  k: number;
  /** Total tiendas activas de la zona. */
  totalStores: number;
  clusters: ProposedCluster[];
  /** Balance score: 0 = perfectamente balanceado por store count, 1 = todo en uno. */
  imbalanceScore: number;
  /** Mismo concepto para volumen kg/sem (no count). */
  imbalanceScoreKg: number;
}

// Paleta consistente con pickRouteColor — los 6 primeros colores son los
// alias canónicos de camionetas (Roja/Azul/Verde/Amarilla/Negra/Blanca).
const CLUSTER_COLORS = [
  '#dc2626', // rojo
  '#2563eb', // azul
  '#16a34a', // verde
  '#ca8a04', // amarillo (mostaza)
  '#1f2937', // negro/grafito
  '#9ca3af', // gris/blanca
  '#9333ea', // morado
  '#0891b2', // teal
];

/**
 * Métrica de desbalance entre clusters. 0 = todos iguales, 1 = uno tiene
 * todo. Calculada como Gini-simplified sobre los valores.
 */
function imbalance(values: number[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const mean = total / values.length;
  if (mean === 0) return 0;
  const variance =
    values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
  const stddev = Math.sqrt(variance);
  // Coeficiente de variación normalizado a [0, 1]. Limpieza pragmática para
  // que dispatchers entiendan: ≤0.15 = balanceado, 0.15-0.35 = aceptable,
  // >0.35 = uno se carga mucho más.
  return Math.min(1, stddev / mean);
}

export async function proposeZoneSplit(
  zoneId: string,
  k: number,
): Promise<ZoneSuggestion | null> {
  if (k < 2 || k > 8) {
    throw new Error(`k debe estar entre 2 y 8, recibido ${k}`);
  }
  const supabase = await createServerClient();

  const { data: zoneRow } = await supabase
    .from('zones')
    .select('id, name, code')
    .eq('id', zoneId)
    .maybeSingle();
  if (!zoneRow) return null;

  // Solo tiendas activas y reales de la zona. Las hipotéticas (is_sandbox)
  // no entran a la propuesta — el análisis es sobre el catálogo operativo.
  const { data: storesRaw } = await supabase
    .from('stores')
    .select('id, code, name, lat, lng')
    .eq('zone_id', zoneId)
    .eq('is_active', true)
    .eq('is_sandbox', false);

  type StoreRow = { id: string; code: string; name: string; lat: number; lng: number };
  const stores = (storesRaw ?? []) as StoreRow[];

  if (stores.length === 0) {
    return {
      zoneId,
      zoneName: zoneRow.name as string,
      zoneCode: zoneRow.code as string,
      k,
      totalStores: 0,
      clusters: [],
      imbalanceScore: 0,
      imbalanceScoreKg: 0,
    };
  }

  // 1. Cluster con bisección recursiva determinística.
  const clusters = clusterStops(
    stores.map((s) => ({ id: s.id, lat: s.lat, lng: s.lng })),
    Math.min(k, stores.length),
  );

  // 2. Frecuencias agregadas (WB-2). Una query batch.
  const freqs = await getStoreFrequencyStats(stores.map((s) => s.id), 30);
  const storeMap = new Map(stores.map((s) => [s.id, s]));

  // 3. Armar la propuesta enriquecida.
  const proposed: ProposedCluster[] = clusters.map((cluster, idx) => {
    const enrichedStores: ProposedClusterStore[] = cluster.map((c) => {
      const full = storeMap.get(c.id)!;
      const freq = freqs.get(c.id);
      const kgPerWeek = freq && freq.kgPerVisit !== null
        ? freq.kgPerVisit * freq.visitsPerWeek
        : 0;
      return {
        id: full.id,
        code: full.code,
        name: full.name,
        lat: full.lat,
        lng: full.lng,
        visitsPerWeek: freq?.visitsPerWeek ?? 0,
        kgPerVisit: freq?.kgPerVisit ?? null,
        kgPerWeek: Math.round(kgPerWeek * 10) / 10,
      };
    });

    const totalVisitsPerWeek = enrichedStores.reduce(
      (s, st) => s + st.visitsPerWeek,
      0,
    );
    const totalKgPerWeek = enrichedStores.reduce((s, st) => s + st.kgPerWeek, 0);

    return {
      index: idx + 1,
      color: CLUSTER_COLORS[idx % CLUSTER_COLORS.length]!,
      stores: enrichedStores,
      centroid: centroid(cluster),
      storeCount: enrichedStores.length,
      totalVisitsPerWeek: Math.round(totalVisitsPerWeek * 10) / 10,
      totalKgPerWeek: Math.round(totalKgPerWeek * 10) / 10,
    };
  });

  const imbalanceScore = imbalance(proposed.map((c) => c.storeCount));
  const imbalanceScoreKg = imbalance(proposed.map((c) => c.totalKgPerWeek));

  return {
    zoneId,
    zoneName: zoneRow.name as string,
    zoneCode: zoneRow.code as string,
    k,
    totalStores: stores.length,
    clusters: proposed,
    imbalanceScore: Math.round(imbalanceScore * 100) / 100,
    imbalanceScoreKg: Math.round(imbalanceScoreKg * 100) / 100,
  };
}
