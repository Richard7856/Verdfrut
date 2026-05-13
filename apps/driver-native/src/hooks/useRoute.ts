// Hook que orquesta la carga de la ruta del día con cache offline.
//
// Estados que la UI maneja:
//   - isLoading: primera carga sin cache disponible (mostrar skeleton).
//   - isRefreshing: refetch manual (RefreshControl spinner).
//   - error: el último intento de fetch falló (puede haber `data` del cache).
//   - data: el bundle más reciente (de cache o de red).
//   - isStale: data viene de cache, no del fetch actual (banner amarillo).
//
// Flujo en primer mount:
//   1. Leer cache → si existe, setData(cache) + isStale=true + isLoading=false.
//   2. Hacer fetch real → onSuccess setData(real) + isStale=false; onError setError.
//   3. Si NO había cache y el fetch falla → isLoading=false + error.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { readCache, writeCache } from '@/lib/cache';
import { getDriverRouteBundle, type RouteBundle } from '@/lib/queries/route';
import { todayInZone } from '@/lib/datetime';

const CACHE_NAMESPACE = 'route';

interface UseRouteState {
  data: RouteBundle | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  isStale: boolean;
  /** Refetch manual (pull-to-refresh). */
  refresh: () => Promise<void>;
}

export function useRoute(timeZone?: string): UseRouteState {
  const [data, setData] = useState<RouteBundle | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const date = todayInZone(timeZone);

  const fetchAndCache = useCallback(
    async (opts: { silent: boolean }): Promise<void> => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) {
          // Sin sesión no podemos pedir datos. AuthGate redirige a login,
          // así que sólo marcamos no-loading y salimos.
          if (!opts.silent) setError('Sin sesión activa');
          setData(null);
          setIsLoading(false);
          return;
        }

        const bundle = await getDriverRouteBundle(date);
        setData(bundle);
        setIsStale(false);
        setError(null);

        // Guardamos cache incluso si bundle es null — así al volver offline
        // mostramos "Sin ruta hoy" en lugar de un loading infinito.
        await writeCache(CACHE_NAMESPACE, `${userId}:${date}`, bundle);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        // Si ya teníamos data del cache, dejamos data tal cual y marcamos error.
        // Si no, data sigue null y la UI muestra el estado de error.
        setError(message);
        console.warn('[useRoute] fetch failed:', message);
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [date],
  );

  // Mount: leer cache + fetch en paralelo
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        if (!cancelled) setIsLoading(false);
        return;
      }

      const cached = await readCache<RouteBundle | null>(CACHE_NAMESPACE, `${userId}:${date}`);
      if (cached && !cancelled) {
        setData(cached.data);
        setIsStale(true);
        setIsLoading(false); // ya tenemos algo que mostrar
      }
      if (!cancelled) {
        await fetchAndCache({ silent: Boolean(cached) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date, fetchAndCache]);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    await fetchAndCache({ silent: false });
  }, [fetchAndCache]);

  return { data, isLoading, isRefreshing, error, isStale, refresh };
}
