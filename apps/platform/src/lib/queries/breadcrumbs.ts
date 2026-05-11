// Queries de route_breadcrumbs — posiciones GPS publicadas por el driver.
// ADR-054: usado por el live map server component para mostrar último punto
// de cada chofer activo en una sola query (evita N+1).

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';

export interface LastBreadcrumb {
  lat: number;
  lng: number;
  recordedAt: string;
}

/**
 * Devuelve el último breadcrumb publicado por cada `route_id` pedido.
 *
 * Estrategia: pedimos los breadcrumbs de los últimos 60 min para esos route_ids
 * con `order(recorded_at desc)`, luego agrupamos en memoria. 60 min cubre la
 * granularidad del live map sin traer históricos enteros. Si una ruta no tiene
 * breadcrumb reciente, el Map no la incluye → el caller usa `null`.
 *
 * Alternativa más eficiente con DISTINCT ON requiere SQL raw (Supabase JS no
 * lo expone). Si crece el tráfico, migrar a RPC.
 */
export async function getLastBreadcrumbsByRouteIds(
  routeIds: string[],
  options?: { lookbackMinutes?: number },
): Promise<Map<string, LastBreadcrumb>> {
  const result = new Map<string, LastBreadcrumb>();
  if (routeIds.length === 0) return result;

  const lookbackMinutes = options?.lookbackMinutes ?? 60;
  const cutoff = new Date(Date.now() - lookbackMinutes * 60_000).toISOString();

  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('route_breadcrumbs')
    .select('route_id, lat, lng, recorded_at')
    .in('route_id', routeIds)
    .gte('recorded_at', cutoff)
    .order('recorded_at', { ascending: false });

  if (error) throw new Error(`[breadcrumbs.lastByRouteIds] ${error.message}`);

  for (const row of data ?? []) {
    const id = row.route_id as string;
    // Como vienen en orden descendente, el primero que veamos por route_id es
    // el más reciente. Si ya está en el Map lo dejamos.
    if (!result.has(id)) {
      result.set(id, {
        lat: row.lat as number,
        lng: row.lng as number,
        recordedAt: row.recorded_at as string,
      });
    }
  }
  return result;
}
