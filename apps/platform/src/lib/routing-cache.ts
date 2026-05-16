import 'server-only';

// Cache pair-by-pair para matrices de routing (Mapbox / Google Routes).
// ADR-107 / OE-4a.
//
// Reduce el costo de API en ~70%+ en operación real porque el dispatcher
// reusa el mismo set de tiendas múltiples veces al día (propose → apply,
// re-propose con misma flota, etc.). Cada par `(origin_lat,lng → dest_lat,lng)`
// se persiste con TTL 7d.
//
// API pública:
//   - getCachedMatrix(coords, customerId, provider, profile, fetchFresh):
//       intenta sacar la matriz N×N del cache. Si falta UN solo par, llama
//       `fetchFresh` (la función que sí pega a Mapbox/Google), obtiene la
//       matriz completa, y persiste TODOS los pares para futuros hits.
//   - Telemetría: counter de hit/miss + estimado de costo ahorrado.

import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export type RoutingProvider = 'mapbox' | 'google' | 'haversine';

export interface CachedMatrix {
  durations: number[][];
  distances: number[][];
}

interface CacheLookupParams {
  coords: Array<[number, number]>; // [lng, lat]
  customerId: string;
  provider: RoutingProvider;
  profile: string; // 'driving-traffic' | 'driving' | etc
}

interface CacheStats {
  hits: number;
  misses: number;
  totalPairs: number;
  estimatedCostSavedUsd: number;
}

/**
 * Costo aprox por par de Mapbox Matrix (extrapolado de $2/1k requests con
 * matrices ~N²). Conservador: contamos cada par como $0.002/1k = $0.000002.
 * Realmente Mapbox cobra por matrix request (no por par individual), pero
 * para telemetría per-hit este es el ahorro marginal estimado.
 */
const COST_PER_PAIR_USD: Record<RoutingProvider, number> = {
  mapbox: 0.000002,
  google: 0.000005,
  haversine: 0, // gratis, sin sentido cachear pero por completitud
};

/**
 * Round a 7 decimales (~1cm precisión). Mapbox devuelve exactamente las
 * coords que mandas, así que el round es para evitar diff por float jitter
 * (1e-15) entre runs de JS.
 */
function roundCoord(value: number): number {
  return Math.round(value * 1e7) / 1e7;
}

/**
 * Genera todos los pares (origin, destination) de una lista de coords.
 * Skip i==j (distancia a uno mismo es siempre 0, no se cachea).
 */
function generateAllPairs(
  coords: Array<[number, number]>,
): Array<{ originLng: number; originLat: number; destLng: number; destLat: number; i: number; j: number }> {
  const pairs: Array<{
    originLng: number;
    originLat: number;
    destLng: number;
    destLat: number;
    i: number;
    j: number;
  }> = [];
  for (let i = 0; i < coords.length; i++) {
    for (let j = 0; j < coords.length; j++) {
      if (i === j) continue;
      pairs.push({
        originLng: roundCoord(coords[i]![0]),
        originLat: roundCoord(coords[i]![1]),
        destLng: roundCoord(coords[j]![0]),
        destLat: roundCoord(coords[j]![1]),
        i,
        j,
      });
    }
  }
  return pairs;
}

/**
 * Lookup bulk de pairs cacheados. Devuelve un Map keyed por "origLng,origLat→destLng,destLat"
 * con {duration, distance, id} solo de los que están vivos (expires_at > now).
 *
 * Trade-off de query: con N=20 coords son 380 pairs. Hacer un IN con 380
 * tuplas compuestas es feo en Postgres. Alternativa: query con OR ridículo
 * o N queries. Optamos por: hacer un SELECT amplio por customer_id + filtro
 * por bbox de coords (lat/lng entre min/max), luego filtrar client-side por
 * los pares exactos. Reduce la tabla a un set manejable sin ser super preciso.
 */
async function lookupCachedPairs(
  params: CacheLookupParams,
  pairs: ReturnType<typeof generateAllPairs>,
): Promise<Map<string, { duration: number; distance: number; id: string }>> {
  if (pairs.length === 0) return new Map();
  const admin = createServiceRoleClient();

  // Bbox del set de coords — todas las origins/dests caen aquí.
  const allLats = pairs.flatMap((p) => [p.originLat, p.destLat]);
  const allLngs = pairs.flatMap((p) => [p.originLng, p.destLng]);
  const minLat = Math.min(...allLats);
  const maxLat = Math.max(...allLats);
  const minLng = Math.min(...allLngs);
  const maxLng = Math.max(...allLngs);

  const { data, error } = await admin
    .from('routing_matrix_pairs')
    .select('id, origin_lat, origin_lng, dest_lat, dest_lng, duration_seconds, distance_meters, expires_at')
    .eq('customer_id', params.customerId)
    .eq('provider', params.provider)
    .eq('profile', params.profile)
    .gte('origin_lat', minLat)
    .lte('origin_lat', maxLat)
    .gte('origin_lng', minLng)
    .lte('origin_lng', maxLng)
    .gt('expires_at', new Date().toISOString());

  if (error) {
    logger.warn('routing_cache.lookup_failed', { err: error.message });
    return new Map();
  }

  const cached = new Map<string, { duration: number; distance: number; id: string }>();
  for (const row of data ?? []) {
    const key = `${row.origin_lng},${row.origin_lat}→${row.dest_lng},${row.dest_lat}`;
    cached.set(key, {
      duration: row.duration_seconds as number,
      distance: row.distance_meters as number,
      id: row.id as string,
    });
  }
  return cached;
}

/**
 * Upsert todos los pairs en BD. Se hace UPSERT por la unique constraint
 * (customer_id, origin, dest, provider, profile) — si ya existe, actualiza
 * duration/distance/expires_at. TTL se renueva en cada acceso.
 */
async function persistPairs(
  params: CacheLookupParams,
  matrix: CachedMatrix,
  pairs: ReturnType<typeof generateAllPairs>,
): Promise<void> {
  if (pairs.length === 0) return;
  const admin = createServiceRoleClient();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const rows = pairs.map((p) => ({
    customer_id: params.customerId,
    origin_lat: p.originLat,
    origin_lng: p.originLng,
    dest_lat: p.destLat,
    dest_lng: p.destLng,
    duration_seconds: matrix.durations[p.i]![p.j]!,
    distance_meters: matrix.distances[p.i]![p.j]!,
    provider: params.provider,
    profile: params.profile,
    expires_at: expiresAt,
  }));

  // Postgrest UPSERT: onConflict en la unique constraint.
  const { error } = await admin
    .from('routing_matrix_pairs')
    .upsert(rows as never, {
      onConflict: 'customer_id,origin_lat,origin_lng,dest_lat,dest_lng,provider,profile',
    });
  if (error) {
    logger.warn('routing_cache.upsert_failed', {
      err: error.message,
      pair_count: rows.length,
    });
  }
}

/**
 * Construye la matriz N×N a partir de los pairs cacheados.
 * Devuelve null si falta cualquier par (i,j ≠ i) — el caller decide
 * hacer fetch fresh.
 */
function tryBuildFromCache(
  coords: Array<[number, number]>,
  cached: Map<string, { duration: number; distance: number; id: string }>,
): CachedMatrix | null {
  const n = coords.length;
  const durations: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  const distances: number[][] = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) {
        durations[i]![j] = 0;
        distances[i]![j] = 0;
        continue;
      }
      const oLng = roundCoord(coords[i]![0]);
      const oLat = roundCoord(coords[i]![1]);
      const dLng = roundCoord(coords[j]![0]);
      const dLat = roundCoord(coords[j]![1]);
      const key = `${oLng},${oLat}→${dLng},${dLat}`;
      const hit = cached.get(key);
      if (!hit) return null; // miss → recompute todo
      durations[i]![j] = hit.duration;
      distances[i]![j] = hit.distance;
    }
  }
  return { durations, distances };
}

/**
 * Public API: matriz N×N con cache transparente.
 *
 * Comportamiento:
 *  1. Lookup bulk de cached pairs para customer + provider + profile.
 *  2. Intenta build matriz solo de cache. Si 100% hit → return + log.
 *  3. Si falta cualquier par → call `fetchFresh` (Mapbox/Google API real),
 *     obtiene matriz, persiste TODOS los pares para hits futuros, return.
 *  4. Telemetría: log siempre con stats {hits, misses, costSaved}.
 */
export async function getCachedMatrix(
  params: CacheLookupParams,
  fetchFresh: (coords: Array<[number, number]>) => Promise<CachedMatrix>,
): Promise<{ matrix: CachedMatrix; stats: CacheStats }> {
  const { coords, customerId, provider, profile } = params;
  const totalPairs = coords.length * (coords.length - 1);

  // Edge cases: 0-1 coord no requieren matriz real.
  if (coords.length < 2) {
    return {
      matrix: { durations: [[0]], distances: [[0]] },
      stats: { hits: 0, misses: 0, totalPairs: 0, estimatedCostSavedUsd: 0 },
    };
  }

  const pairs = generateAllPairs(coords);
  const cached = await lookupCachedPairs(params, pairs);
  const fromCache = tryBuildFromCache(coords, cached);

  if (fromCache) {
    const stats: CacheStats = {
      hits: totalPairs,
      misses: 0,
      totalPairs,
      estimatedCostSavedUsd: totalPairs * COST_PER_PAIR_USD[provider],
    };
    logger.info('routing_cache.hit_full', {
      customer_id: customerId,
      provider,
      profile,
      coord_count: coords.length,
      pair_count: totalPairs,
      cost_saved_usd: stats.estimatedCostSavedUsd.toFixed(6),
    });
    return { matrix: fromCache, stats };
  }

  // Miss parcial o total → fetch + persist.
  const fresh = await fetchFresh(coords);
  await persistPairs(params, fresh, pairs);

  const hitCount = cached.size;
  const missCount = totalPairs - hitCount;
  const stats: CacheStats = {
    hits: hitCount,
    misses: missCount,
    totalPairs,
    estimatedCostSavedUsd: hitCount * COST_PER_PAIR_USD[provider],
  };
  logger.info('routing_cache.partial_or_miss', {
    customer_id: customerId,
    provider,
    profile,
    coord_count: coords.length,
    pair_count: totalPairs,
    hits: hitCount,
    misses: missCount,
    cost_saved_usd: stats.estimatedCostSavedUsd.toFixed(6),
  });
  return { matrix: fresh, stats };
}
