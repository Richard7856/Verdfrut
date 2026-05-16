'use server';

// Clone Dispatch action (ADR-113 / Workbench WB-1b).
//
// Soporta dos direcciones simétricas:
//   • Promote (sandbox → real): copia un dispatch sandbox a operación real.
//     Valida que TODAS las referencias de catálogo (vehicle_id, driver_id,
//     store_id) apunten a items reales — bloquea si alguna es sandbox.
//   • Clone-to-sandbox (real → sandbox): copia un dispatch real al sandbox
//     para experimentar. Sin validación (clonar a sandbox siempre es seguro).
//
// El source dispatch queda intacto en ambos casos — copy, no move. El admin
// decide si lo borra después (manualmente o via Reset del sandbox).
//
// NO es transaccional via RPC: secuencial con cleanup-on-error. Para WB-1b
// MVP es aceptable; si emergen inconsistencias bajo carga, migrar a una RPC
// `tripdrive_clone_dispatch` que haga todo en transacción.

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth';
import { createServerClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

export interface CloneDispatchResult {
  ok: boolean;
  error?: string;
  /** UUID del dispatch nuevo. Undefined si falló. */
  newDispatchId?: string;
  /** Resumen para toast: cuántas rutas y paradas se copiaron. */
  summary?: { routes: number; stops: number };
}

export async function cloneDispatchAction(
  dispatchId: string,
  targetSandbox: boolean,
): Promise<CloneDispatchResult> {
  const profile = await requireRole('admin', 'dispatcher');
  const supabase = await createServerClient();

  // 1. Cargar source dispatch + routes + stops.
  const { data: source, error: srcErr } = await supabase
    .from('dispatches')
    .select(
      'id, name, date, zone_id, customer_id, status, notes, is_sandbox',
    )
    .eq('id', dispatchId)
    .maybeSingle();
  if (srcErr || !source) {
    return { ok: false, error: 'Tiro no encontrado o sin acceso.' };
  }

  // Validar dirección: si target=real, source debe ser sandbox y viceversa.
  // No tiene sentido "clonar" un real a real ni un sandbox a sandbox.
  if (Boolean(source.is_sandbox) === targetSandbox) {
    return {
      ok: false,
      error: targetSandbox
        ? 'Este tiro ya está en el modo planeación.'
        : 'Este tiro ya está en operación real.',
    };
  }

  const { data: srcRoutes, error: rErr } = await supabase
    .from('routes')
    .select('id, name, vehicle_id, driver_id, depot_override_id')
    .eq('dispatch_id', dispatchId);
  if (rErr) return { ok: false, error: `No se pudieron leer las rutas: ${rErr.message}` };

  const routeIds = (srcRoutes ?? []).map((r) => r.id as string);
  const { data: srcStops, error: sErr } = routeIds.length > 0
    ? await supabase
        .from('stops')
        .select(
          'id, route_id, store_id, sequence, status, planned_arrival_at, planned_departure_at, load, notes',
        )
        .in('route_id', routeIds)
    : { data: [] as never[], error: null };
  if (sErr) return { ok: false, error: `No se pudieron leer las paradas: ${sErr.message}` };

  // 2. Validar catálogo refs si vamos a REAL. Bloquear si alguna ref es sandbox.
  if (!targetSandbox) {
    const vehicleIds = [...new Set((srcRoutes ?? []).map((r) => r.vehicle_id as string))];
    const driverIds = [
      ...new Set(
        (srcRoutes ?? [])
          .map((r) => r.driver_id as string | null)
          .filter((id): id is string => id !== null),
      ),
    ];
    const storeIds = [...new Set((srcStops ?? []).map((s) => s.store_id as string))];

    const [vRes, dRes, stRes] = await Promise.all([
      vehicleIds.length > 0
        ? supabase
            .from('vehicles')
            .select('id, plate, alias, is_sandbox')
            .in('id', vehicleIds)
        : Promise.resolve({ data: [] as Array<{ id: string; plate: string; alias: string | null; is_sandbox: boolean }>, error: null }),
      driverIds.length > 0
        ? supabase
            .from('drivers')
            .select('id, is_sandbox')
            .in('id', driverIds)
        : Promise.resolve({ data: [] as Array<{ id: string; is_sandbox: boolean }>, error: null }),
      storeIds.length > 0
        ? supabase
            .from('stores')
            .select('id, code, name, is_sandbox')
            .in('id', storeIds)
        : Promise.resolve({ data: [] as Array<{ id: string; code: string; name: string; is_sandbox: boolean }>, error: null }),
    ]);

    const sandboxVehicles = (vRes.data ?? []).filter((v) => v.is_sandbox);
    const sandboxDrivers = (dRes.data ?? []).filter((d) => d.is_sandbox);
    const sandboxStores = (stRes.data ?? []).filter((s) => s.is_sandbox);

    if (sandboxVehicles.length + sandboxDrivers.length + sandboxStores.length > 0) {
      const parts: string[] = [];
      if (sandboxVehicles.length > 0) {
        parts.push(
          `Camioneta(s) hipotéticas: ${sandboxVehicles
            .map((v) => v.alias ?? v.plate)
            .join(', ')}`,
        );
      }
      if (sandboxDrivers.length > 0) {
        parts.push(`${sandboxDrivers.length} chofer(es) hipotéticos`);
      }
      if (sandboxStores.length > 0) {
        parts.push(
          `Tienda(s) hipotéticas: ${sandboxStores
            .slice(0, 3)
            .map((s) => s.code)
            .join(', ')}${sandboxStores.length > 3 ? '…' : ''}`,
        );
      }
      return {
        ok: false,
        error:
          'No se puede promover: este escenario usa catálogo hipotético. ' +
          'Para promover, reemplaza estas referencias por items reales en el modo planeación: ' +
          parts.join(' · '),
      };
    }
  }

  // 3. Insertar dispatch nuevo. Status reset a 'planning' — el promote no
  //    arrastra estados operativos (no tiene sentido un dispatch 'dispatched'
  //    en sandbox sin choferes reales).
  const nameSuffix = targetSandbox ? ' (sandbox)' : ' (promovido)';
  const newName = `${source.name}${nameSuffix}`;
  const { data: newDispatch, error: nErr } = await supabase
    .from('dispatches')
    .insert({
      name: newName.slice(0, 80),
      date: source.date,
      zone_id: source.zone_id as string,
      status: 'planning',
      notes: source.notes as string | null,
      created_by: profile.id,
      is_sandbox: targetSandbox,
    })
    .select('id')
    .single();
  if (nErr || !newDispatch) {
    return { ok: false, error: `No se pudo crear el tiro nuevo: ${nErr?.message ?? 'desconocido'}` };
  }
  const newDispatchId = newDispatch.id as string;

  // 4. Clonar cada ruta + sus stops. Mapa srcRouteId → newRouteId para enlazar
  //    los stops.
  const routeIdMap = new Map<string, string>();
  for (const r of srcRoutes ?? []) {
    const { data: newRoute, error: rInsErr } = await supabase
      .from('routes')
      .insert({
        dispatch_id: newDispatchId,
        name: r.name as string,
        date: source.date as string,
        zone_id: source.zone_id as string,
        vehicle_id: r.vehicle_id as string,
        driver_id: r.driver_id as string | null,
        depot_override_id: r.depot_override_id as string | null,
        status: 'DRAFT',
        created_by: profile.id,
        is_sandbox: targetSandbox,
      })
      .select('id')
      .single();
    if (rInsErr || !newRoute) {
      // Cleanup parcial: borrar lo creado para no dejar zombies.
      await supabase.from('dispatches').delete().eq('id', newDispatchId);
      logger.error('workbench.clone_dispatch.route_failed', {
        source_dispatch_id: dispatchId,
        new_dispatch_id: newDispatchId,
        err: rInsErr?.message,
      });
      return {
        ok: false,
        error: `Falló al clonar una ruta: ${rInsErr?.message ?? 'desconocido'}`,
      };
    }
    routeIdMap.set(r.id as string, newRoute.id as string);
  }

  // 5. Clonar stops en bulk usando el map.
  let totalStops = 0;
  if ((srcStops ?? []).length > 0) {
    const stopsPayload = (srcStops ?? []).map((s) => ({
      route_id: routeIdMap.get(s.route_id as string)!,
      store_id: s.store_id as string,
      sequence: s.sequence as number,
      // Reset status — los stops promovidos arrancan pending. Sandbox preserva
      // sus estados también porque la operación no se ejecutó realmente.
      status: 'pending' as const,
      planned_arrival_at: s.planned_arrival_at as string | null,
      planned_departure_at: s.planned_departure_at as string | null,
      load: s.load as number[],
      notes: s.notes as string | null,
      is_sandbox: targetSandbox,
    }));
    const { error: sInsErr } = await supabase.from('stops').insert(stopsPayload as never);
    if (sInsErr) {
      // Cleanup: rutas y dispatch nuevos.
      const newRouteIds = [...routeIdMap.values()];
      if (newRouteIds.length > 0) {
        await supabase.from('routes').delete().in('id', newRouteIds);
      }
      await supabase.from('dispatches').delete().eq('id', newDispatchId);
      logger.error('workbench.clone_dispatch.stops_failed', {
        source_dispatch_id: dispatchId,
        new_dispatch_id: newDispatchId,
        err: sInsErr.message,
      });
      return {
        ok: false,
        error: `Falló al clonar las paradas: ${sInsErr.message}`,
      };
    }
    totalStops = stopsPayload.length;
  }

  logger.info('workbench.clone_dispatch.ok', {
    source_dispatch_id: dispatchId,
    new_dispatch_id: newDispatchId,
    target_sandbox: targetSandbox,
    routes: routeIdMap.size,
    stops: totalStops,
    triggered_by: profile.id,
  });

  revalidatePath('/dispatches');
  revalidatePath('/dia');
  revalidatePath(`/dispatches/${newDispatchId}`);

  return {
    ok: true,
    newDispatchId,
    summary: { routes: routeIdMap.size, stops: totalStops },
  };
}
