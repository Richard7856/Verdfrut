'use server';

// Server action del Visual Dispatch Builder (Phase 4).
// Crea un dispatch + N rutas + sus stops en una sola operación.
//
// IMPORTANTE — modelo de transaccionalidad:
//   No usamos una RPC para esto porque ya existe la tabla `dispatches`
//   y las queries individuales son tolerables. Si una falla a mitad de la
//   operación, la siguiente petición del user verá el dispatch a medio
//   construir — el dispatcher lo verá en /dispatches y puede borrarlo
//   manualmente. No es ideal pero es OK para MVP.
//
//   Si en producción esto se vuelve un problema (race conditions, fallas
//   a mitad), migrar a una RPC `tripdrive_create_visual_dispatch` que
//   reciba el JSON completo y haga todo dentro de una transacción.

import { revalidatePath } from 'next/cache';
import { logger } from '@tripdrive/observability';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { getStoresByIds } from '@/lib/queries/stores';
import { isSandboxMode } from '@/lib/workbench-mode';

export interface RoutePlanPayload {
  vehicleId: string;
  driverId: string | null;
  storeIds: string[];
}

export interface CreateVisualDispatchInput {
  name: string;
  date: string;
  zoneId: string;
  routes: RoutePlanPayload[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createVisualDispatchAction(input: CreateVisualDispatchInput): Promise<{
  ok: boolean;
  error?: string;
  dispatchId?: string;
}> {
  try {
    const profile = await requireRole('admin', 'dispatcher');

    // Validación.
    const name = String(input.name ?? '').trim();
    if (name.length < 2 || name.length > 80) {
      return { ok: false, error: 'Nombre del tiro debe tener entre 2 y 80 caracteres.' };
    }
    if (!DATE_RE.test(input.date)) {
      return { ok: false, error: 'Fecha debe ser YYYY-MM-DD.' };
    }
    if (!UUID_RE.test(input.zoneId)) {
      return { ok: false, error: 'zoneId inválido.' };
    }
    if (!Array.isArray(input.routes) || input.routes.length === 0) {
      return { ok: false, error: 'Agrega al menos una camioneta con paradas.' };
    }
    if (input.routes.length > 50) {
      return { ok: false, error: 'Máximo 50 rutas por tiro.' };
    }
    for (const r of input.routes) {
      if (!UUID_RE.test(r.vehicleId)) {
        return { ok: false, error: 'Vehículo con UUID inválido.' };
      }
      if (r.driverId && !UUID_RE.test(r.driverId)) {
        return { ok: false, error: 'Chofer con UUID inválido.' };
      }
      if (!Array.isArray(r.storeIds) || r.storeIds.length === 0) {
        return { ok: false, error: 'Cada camioneta debe tener al menos una parada.' };
      }
      if (r.storeIds.length > 100) {
        return { ok: false, error: 'Máximo 100 paradas por ruta.' };
      }
      for (const sid of r.storeIds) {
        if (!UUID_RE.test(sid)) {
          return { ok: false, error: 'storeId inválido.' };
        }
      }
    }

    // Verificar que ningún store aparece en 2 rutas (defensa contra bug del cliente).
    const seenStoreIds = new Set<string>();
    for (const r of input.routes) {
      for (const sid of r.storeIds) {
        if (seenStoreIds.has(sid)) {
          return { ok: false, error: `Tienda ${sid.slice(0, 8)}… asignada a más de una ruta.` };
        }
        seenStoreIds.add(sid);
      }
    }

    // Verificar que las stores existen + pertenecen a la zona.
    const allStoreIds = [...seenStoreIds];
    const stores = await getStoresByIds(allStoreIds);
    if (stores.length !== allStoreIds.length) {
      return { ok: false, error: 'Alguna tienda no existe o no es accesible.' };
    }
    for (const s of stores) {
      if (s.zoneId !== input.zoneId) {
        return { ok: false, error: `Tienda ${s.code} no pertenece a la zona elegida.` };
      }
    }

    const supabase = await createServerClient();
    // ADR-112: el flag is_sandbox se propaga a TODA la jerarquía (dispatch +
    // routes + stops) según el modo del caller. Si está en sandbox, todo lo
    // que cree va al sandbox compartido del customer.
    const sandbox = await isSandboxMode();

    // 1. Crear dispatch.
    const { data: dispatch, error: dispatchErr } = await supabase
      .from('dispatches')
      .insert({
        name,
        date: input.date,
        zone_id: input.zoneId,
        status: 'planning',
        notes: null,
        created_by: profile.id,
        is_sandbox: sandbox,
      })
      .select('id')
      .single();
    if (dispatchErr || !dispatch) {
      return {
        ok: false,
        error: `No se pudo crear el tiro: ${dispatchErr?.message ?? 'desconocido'}`,
      };
    }
    const dispatchId = dispatch.id as string;

    // 2. Crear cada ruta + sus stops.
    const createdRouteIds: string[] = [];
    for (let i = 0; i < input.routes.length; i++) {
      const r = input.routes[i]!;
      const routeName = `${name} — ruta ${i + 1}`;
      const { data: route, error: routeErr } = await supabase
        .from('routes')
        .insert({
          dispatch_id: dispatchId,
          name: routeName,
          date: input.date,
          zone_id: input.zoneId,
          vehicle_id: r.vehicleId,
          driver_id: r.driverId,
          status: 'DRAFT',
          created_by: profile.id,
          is_sandbox: sandbox,
        })
        .select('id')
        .single();
      if (routeErr || !route) {
        logger.error('dispatches.visual.route_failed', {
          dispatch_id: dispatchId,
          vehicle_id: r.vehicleId,
          error: routeErr?.message,
        });
        return {
          ok: false,
          error: `Falló crear ruta ${i + 1}: ${routeErr?.message ?? 'desconocido'}. ` +
            `El tiro se creó parcialmente con ${createdRouteIds.length} ruta(s). ` +
            `Revisa /dispatches/${dispatchId} y completa o cancela manualmente.`,
          dispatchId,
        };
      }
      const routeId = route.id as string;
      createdRouteIds.push(routeId);

      // Insertar stops para esta ruta. Sequence 1..N en el orden recibido del cliente
      // (no es óptimo — el user puede correr "Optimizar" después).
      const stopsPayload = r.storeIds.map((sid, idx) => ({
        route_id: routeId,
        store_id: sid,
        sequence: idx + 1,
        status: 'pending' as const,
        is_sandbox: sandbox,
      }));
      const { error: stopsErr } = await supabase.from('stops').insert(stopsPayload as never);
      if (stopsErr) {
        logger.error('dispatches.visual.stops_failed', {
          dispatch_id: dispatchId,
          route_id: routeId,
          error: stopsErr.message,
        });
        return {
          ok: false,
          error: `Falló crear paradas de ruta ${i + 1}: ${stopsErr.message}. ` +
            `Tiro creado parcialmente. Revisa /dispatches/${dispatchId}.`,
          dispatchId,
        };
      }
    }

    logger.info('dispatches.visual.created', {
      dispatch_id: dispatchId,
      route_count: createdRouteIds.length,
      total_stops: [...seenStoreIds].length,
    });

    revalidatePath('/dispatches');
    revalidatePath(`/dispatches/${dispatchId}`);

    return { ok: true, dispatchId };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error desconocido',
    };
  }
}
