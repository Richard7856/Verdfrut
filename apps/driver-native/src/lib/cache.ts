// Cache de datos por usuario en AsyncStorage con TTL y versionado.
//
// Pattern: stale-while-revalidate.
//   1. Pantalla pide datos → leemos cache primero (si existe) y mostramos.
//   2. En paralelo, fetch real al backend.
//   3. Cuando llega el real, lo guardamos y la UI se re-renderiza.
//
// El versionado evita problemas cuando cambiamos el shape del cache:
//   bump CACHE_VERSION y los caches viejos se ignoran. La próxima carga los
//   sobreescribe.
//
// El TTL no es para invalidar (siempre revalidamos) sino para descartar entries
// muy viejas. Una ruta de hace 1 semana no le sirve al chofer hoy.

import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_VERSION = 1;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24h

interface CacheEnvelope<T> {
  v: number;
  savedAt: number;
  data: T;
}

function buildKey(namespace: string, scope: string): string {
  return `tripdrive-cache:v${CACHE_VERSION}:${namespace}:${scope}`;
}

export async function readCache<T>(
  namespace: string,
  scope: string,
  opts?: { ttlMs?: number },
): Promise<{ data: T; ageMs: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(buildKey(namespace, scope));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope<T>;
    if (parsed.v !== CACHE_VERSION) return null;
    const ageMs = Date.now() - parsed.savedAt;
    const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
    if (ageMs > ttl) return null;
    return { data: parsed.data, ageMs };
  } catch (err) {
    console.warn(`[cache.read] ${namespace}/${scope} parse error:`, err);
    return null;
  }
}

export async function writeCache<T>(namespace: string, scope: string, data: T): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = {
      v: CACHE_VERSION,
      savedAt: Date.now(),
      data,
    };
    await AsyncStorage.setItem(buildKey(namespace, scope), JSON.stringify(envelope));
  } catch (err) {
    // Cache failure no debe romper la operación — sólo log.
    console.warn(`[cache.write] ${namespace}/${scope} failed:`, err);
  }
}

export async function clearCacheNamespace(namespace: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `tripdrive-cache:v${CACHE_VERSION}:${namespace}:`;
    const toRemove = keys.filter((k) => k.startsWith(prefix));
    if (toRemove.length > 0) {
      await AsyncStorage.multiRemove(toRemove);
    }
  } catch (err) {
    console.warn(`[cache.clear] ${namespace} failed:`, err);
  }
}
