// Queries de stops. Server-only.
// Una stop pertenece a una route. El sequence lo asigna el optimizer.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { Stop, StopStatus } from '@verdfrut/types';

interface StopRow {
  id: string;
  route_id: string;
  store_id: string;
  sequence: number;
  status: StopStatus;
  planned_arrival_at: string | null;
  planned_departure_at: string | null;
  actual_arrival_at: string | null;
  actual_departure_at: string | null;
  load: number[];
  notes: string | null;
  created_at: string;
}

const STOP_COLS = `
  id, route_id, store_id, sequence, status,
  planned_arrival_at, planned_departure_at, actual_arrival_at, actual_departure_at,
  load, notes, created_at
`;

function toStop(row: StopRow): Stop {
  return {
    id: row.id,
    routeId: row.route_id,
    storeId: row.store_id,
    sequence: row.sequence,
    status: row.status,
    plannedArrivalAt: row.planned_arrival_at,
    plannedDepartureAt: row.planned_departure_at,
    actualArrivalAt: row.actual_arrival_at,
    actualDepartureAt: row.actual_departure_at,
    load: row.load,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

export async function listStopsForRoute(routeId: string): Promise<Stop[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('stops')
    .select(STOP_COLS)
    .eq('route_id', routeId)
    .order('sequence');

  if (error) throw new Error(`[stops.listForRoute] ${error.message}`);
  return (data ?? []).map(toStop);
}

interface CreateStopsInput {
  routeId: string;
  stops: Array<{
    storeId: string;
    sequence: number;
    load?: number[];
    plannedArrivalAt?: string | null;
    plannedDepartureAt?: string | null;
  }>;
}

/**
 * Inserta múltiples paradas en bulk. Usado al crear/optimizar una ruta.
 * Si ya existían paradas para la ruta, hay que borrarlas antes (deleteStopsForRoute).
 */
export async function createStops(input: CreateStopsInput): Promise<Stop[]> {
  if (input.stops.length === 0) return [];
  const supabase = await createServerClient();

  const rows = input.stops.map((s) => ({
    route_id: input.routeId,
    store_id: s.storeId,
    sequence: s.sequence,
    load: s.load ?? [],
    planned_arrival_at: s.plannedArrivalAt ?? null,
    planned_departure_at: s.plannedDepartureAt ?? null,
    status: 'pending' as StopStatus,
  }));

  const { data, error } = await supabase.from('stops').insert(rows).select(STOP_COLS);
  if (error) throw new Error(`[stops.create] ${error.message}`);
  return (data ?? []).map(toStop);
}

/**
 * Borra todas las paradas de una ruta (para re-optimizar).
 * Solo válido si la ruta no está PUBLISHED en adelante.
 */
export async function deleteStopsForRoute(routeId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.from('stops').delete().eq('route_id', routeId);
  if (error) throw new Error(`[stops.deleteForRoute] ${error.message}`);
}

/**
 * Reordena una parada. El sequence debe ser único por route.
 */
export async function reorderStop(stopId: string, newSequence: number): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase.from('stops').update({ sequence: newSequence }).eq('id', stopId);
  if (error) throw new Error(`[stops.reorder] ${error.message}`);
}

/**
 * Reordena TODAS las paradas de una ruta de golpe.
 * `orderedStopIds[i]` recibirá `sequence = i + 1`.
 *
 * La constraint UNIQUE (route_id, sequence) impide hacer N updates directos
 * (colisión durante el proceso). Estrategia: dos pasadas:
 *   1. Set sequence = sequence + 10000 (mueve todas fuera del rango).
 *   2. Set sequence = nuevo valor para cada id en orden.
 *
 * Sin transacción atómica explícita — supabase-js no las expone limpias.
 * Si falla entre pasos, las stops quedan con sequence > 10000 (la UI se ve mal
 * pero los datos no se corrompen). Aceptable V1; mover a RPC con BEGIN/COMMIT
 * cuando importe garantizar atomicidad.
 */
export async function bulkReorderStops(
  routeId: string,
  orderedStopIds: string[],
): Promise<void> {
  if (orderedStopIds.length === 0) return;
  const supabase = await createServerClient();

  // Paso 1: mover todas las stops de la ruta a sequence > 10000 para liberar
  // el rango 1..N. Usamos rpc-style via .update encadenado por id.
  // Más simple: leemos los sequence actuales y los offseteamos.
  const { data: current, error: readErr } = await supabase
    .from('stops')
    .select('id, sequence')
    .eq('route_id', routeId);
  if (readErr) throw new Error(`[stops.bulkReorder.read] ${readErr.message}`);

  // Update individual a sequence + 10000 (no se puede hacer "+= 10000" en
  // supabase-js sin RPC). Lo aceptamos como costo de simplicidad.
  for (const row of current ?? []) {
    const { error } = await supabase
      .from('stops')
      .update({ sequence: row.sequence + 10000 })
      .eq('id', row.id);
    if (error) throw new Error(`[stops.bulkReorder.offset] ${error.message}`);
  }

  // Paso 2: set sequence final basado en el orden recibido.
  for (let i = 0; i < orderedStopIds.length; i++) {
    const id = orderedStopIds[i];
    if (!id) continue;
    const { error } = await supabase
      .from('stops')
      .update({ sequence: i + 1 })
      .eq('id', id)
      .eq('route_id', routeId); // defensa: solo updateamos stops de esta ruta
    if (error) throw new Error(`[stops.bulkReorder.set] ${error.message}`);
  }
}

/**
 * Agrega una nueva parada a una ruta existente (al final de la secuencia).
 * ADR-036: el dispatcher necesita poder agregar paradas que el optimizer no
 * asignó (tiendas muy lejos, fuera de capacity, etc.) o tiendas nuevas.
 *
 * - sequence: max(sequence) + 1 dentro de la ruta. Si no hay stops, empieza en 1.
 * - status: 'pending'.
 * - planned_arrival_at: null (la próxima re-optimización lo llena, o se queda
 *   sin ETA — el chofer la atiende cuando llegue).
 * - load: array vacío (default).
 *
 * NO valida si la tienda ya está en otra ruta del mismo día — eso es
 * responsabilidad del UI (warning) o del dispatcher.
 */
export async function appendStopToRoute(
  routeId: string,
  storeId: string,
): Promise<{ id: string; sequence: number }> {
  const supabase = await createServerClient();

  // 1. Calcular siguiente sequence
  const { data: existing, error: readErr } = await supabase
    .from('stops')
    .select('sequence')
    .eq('route_id', routeId)
    .order('sequence', { ascending: false })
    .limit(1);
  if (readErr) throw new Error(`[stops.appendToRoute.read] ${readErr.message}`);

  const nextSequence = (existing?.[0]?.sequence ?? 0) + 1;

  // 2. Insert
  const { data, error } = await supabase
    .from('stops')
    .insert({
      route_id: routeId,
      store_id: storeId,
      sequence: nextSequence,
      status: 'pending',
      load: [],
      planned_arrival_at: null,
      planned_departure_at: null,
    })
    .select('id, sequence')
    .single();
  if (error) throw new Error(`[stops.appendToRoute.insert] ${error.message}`);

  return { id: data.id as string, sequence: data.sequence as number };
}

/**
 * Borra una parada de una ruta (solo si está pending — no se puede borrar
 * una parada en la que el chofer ya estuvo o entregó).
 * ADR-036: complemento de `appendStopToRoute` — el dispatcher debe poder
 * deshacer si agregó una parada por error.
 */
export async function deleteStopFromRoute(stopId: string): Promise<void> {
  const supabase = await createServerClient();

  const { data: stop, error: readErr } = await supabase
    .from('stops')
    .select('id, status, route_id')
    .eq('id', stopId)
    .maybeSingle();
  if (readErr || !stop) {
    throw new Error(`[stops.deleteFromRoute] Parada no encontrada`);
  }
  if (stop.status !== 'pending') {
    throw new Error(
      `[stops.deleteFromRoute] No se puede borrar una parada en estado ${stop.status}. Solo pending.`,
    );
  }

  const { error: delErr } = await supabase.from('stops').delete().eq('id', stopId);
  if (delErr) throw new Error(`[stops.deleteFromRoute] ${delErr.message}`);

  // Re-numerar las stops restantes para no dejar huecos.
  const { data: remaining } = await supabase
    .from('stops')
    .select('id, sequence')
    .eq('route_id', stop.route_id)
    .order('sequence');
  if (remaining) {
    for (let i = 0; i < remaining.length; i++) {
      const row = remaining[i];
      if (!row) continue;
      if (row.sequence !== i + 1) {
        await supabase.from('stops').update({ sequence: i + 1 }).eq('id', row.id);
      }
    }
  }
}

/**
 * Mueve una parada de una ruta a otra. ADR-025.
 *
 * Reglas:
 *   - Ambas rutas deben estar en estado editable (DRAFT/OPTIMIZED/APPROVED).
 *   - El stop debe estar en status `pending` (no `arrived` o más).
 *   - Append al final de la ruta destino (sequence = max+1).
 *   - Re-numera la origen para no dejar huecos.
 *
 * NO recalcula `planned_arrival_at` — el dispatcher debe re-optimizar el tiro
 * después si quiere ETAs frescos.
 */
export async function moveStopToAnotherRoute(
  stopId: string,
  targetRouteId: string,
): Promise<void> {
  const supabase = await createServerClient();

  // 1. Lee el stop, su ruta origen y la ruta destino.
  const { data: stop, error: stopErr } = await supabase
    .from('stops')
    .select('id, route_id, status')
    .eq('id', stopId)
    .maybeSingle();
  if (stopErr || !stop) throw new Error('Parada no encontrada.');
  if (stop.status !== 'pending') {
    throw new Error('Solo se pueden mover paradas en estado pending.');
  }
  const sourceRouteId = stop.route_id as string;
  if (sourceRouteId === targetRouteId) {
    return; // no-op
  }

  const { data: routes, error: routesErr } = await supabase
    .from('routes')
    .select('id, status')
    .in('id', [sourceRouteId, targetRouteId]);
  if (routesErr || !routes || routes.length !== 2) {
    throw new Error('Una de las rutas no existe.');
  }
  const editable = new Set(['DRAFT', 'OPTIMIZED', 'APPROVED']);
  for (const r of routes) {
    if (!editable.has(r.status as string)) {
      throw new Error(
        `La ruta ${r.id} está en estado ${r.status}; no se permite mover paradas.`,
      );
    }
  }

  // 2. Calcula el siguiente sequence en la ruta destino (max + 1).
  const { data: targetStops } = await supabase
    .from('stops')
    .select('sequence')
    .eq('route_id', targetRouteId)
    .order('sequence', { ascending: false })
    .limit(1);
  const nextSeq = ((targetStops?.[0]?.sequence as number | undefined) ?? 0) + 1;

  // 3. Mueve el stop. UNIQUE(route_id, sequence) → primero offset arriba,
  // luego asignamos al destino.
  // 3a. Tirar el sequence a un valor temporal alto en el origen para liberar.
  const { error: bumpErr } = await supabase
    .from('stops')
    .update({ sequence: 99999 })
    .eq('id', stopId);
  if (bumpErr) throw new Error(`[stops.move.bump] ${bumpErr.message}`);

  // 3b. Cambiar route_id + sequence final.
  const { error: moveErr } = await supabase
    .from('stops')
    .update({ route_id: targetRouteId, sequence: nextSeq })
    .eq('id', stopId);
  if (moveErr) throw new Error(`[stops.move.commit] ${moveErr.message}`);

  // 4. Re-numera la ruta origen para cerrar el hueco que dejamos.
  const { data: remaining } = await supabase
    .from('stops')
    .select('id, sequence')
    .eq('route_id', sourceRouteId)
    .order('sequence', { ascending: true });
  if (remaining) {
    // Solo re-numerar si hay huecos. Detectar si sequences = 1..N consecutivos.
    let needsRenumber = false;
    for (let i = 0; i < remaining.length; i++) {
      if ((remaining[i]?.sequence as number) !== i + 1) {
        needsRenumber = true;
        break;
      }
    }
    if (needsRenumber) {
      // Mismo patrón que bulkReorderStops — offset y reasignar.
      for (const row of remaining) {
        await supabase
          .from('stops')
          .update({ sequence: (row.sequence as number) + 20000 })
          .eq('id', row.id);
      }
      for (let i = 0; i < remaining.length; i++) {
        const r = remaining[i];
        if (!r) continue;
        await supabase
          .from('stops')
          .update({ sequence: i + 1 })
          .eq('id', r.id);
      }
    }
  }
}

/**
 * Marca una parada como skipped (omitida sin visitar).
 * Solo válido si la parada está pending.
 */
export async function skipStop(stopId: string, reason: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('stops')
    .update({ status: 'skipped', notes: reason })
    .eq('id', stopId)
    .eq('status', 'pending');

  if (error) throw new Error(`[stops.skip] ${error.message}`);
}
