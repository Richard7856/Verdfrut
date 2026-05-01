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
