// Queries de dispatches (tiros). ADR-024.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { Dispatch, DispatchStatus, Route } from '@verdfrut/types';
import { listRoutes } from './routes';

interface DispatchRow {
  id: string;
  name: string;
  date: string;
  zone_id: string;
  status: string;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const DISPATCH_COLS =
  'id, name, date, zone_id, status, notes, created_by, created_at, updated_at';

function toDispatch(row: DispatchRow): Dispatch {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    zoneId: row.zone_id,
    status: row.status as DispatchStatus,
    notes: row.notes,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDispatches(opts?: {
  date?: string;
  zoneId?: string;
}): Promise<Dispatch[]> {
  const supabase = await createServerClient();
  let q = supabase
    .from('dispatches')
    .select(DISPATCH_COLS)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false });
  if (opts?.date) q = q.eq('date', opts.date);
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  const { data, error } = await q;
  if (error) throw new Error(`[dispatches.list] ${error.message}`);
  return (data ?? []).map((r) => toDispatch(r as DispatchRow));
}

export async function getDispatch(id: string): Promise<Dispatch | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('dispatches')
    .select(DISPATCH_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(`[dispatches.get] ${error.message}`);
  return data ? toDispatch(data as DispatchRow) : null;
}

/**
 * Lista las rutas que pertenecen a un dispatch.
 * Reutiliza listRoutes filtrando en cliente — N pequeño (típicamente 1-5 rutas/tiro).
 */
export async function listRoutesByDispatch(dispatchId: string): Promise<Route[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('routes')
    .select('id')
    .eq('dispatch_id', dispatchId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[dispatches.routes] ${error.message}`);
  if (!data || data.length === 0) return [];
  // Aprovechamos listRoutes para mantener el mismo mapper consistente.
  const ids = data.map((r) => r.id as string);
  const { rows } = await listRoutes({ limit: ids.length });
  return rows.filter((r) => ids.includes(r.id));
}

/**
 * Snapshot agregado de un dispatch — útil para card en /dispatches.
 */
export interface DispatchSummary {
  dispatch: Dispatch;
  routeCount: number;
  totalStops: number;
  completedStops: number;
}

export async function listDispatchSummaries(opts?: {
  date?: string;
  zoneId?: string;
}): Promise<DispatchSummary[]> {
  const supabase = await createServerClient();
  const dispatches = await listDispatches(opts);
  if (dispatches.length === 0) return [];

  // Una sola query por todas las rutas asociadas a estos dispatches.
  const ids = dispatches.map((d) => d.id);
  const { data: routes, error } = await supabase
    .from('routes')
    .select('id, dispatch_id')
    .in('dispatch_id', ids);
  if (error) throw new Error(`[dispatches.summary.routes] ${error.message}`);
  const routeIds = (routes ?? []).map((r) => r.id as string);

  // Stops counts
  const { data: stops } = await supabase
    .from('stops')
    .select('id, route_id, status')
    .in('route_id', routeIds);

  return dispatches.map((d) => {
    const dRoutes = (routes ?? []).filter((r) => r.dispatch_id === d.id);
    const dRouteIds = dRoutes.map((r) => r.id as string);
    const dStops = (stops ?? []).filter((s) => dRouteIds.includes(s.route_id as string));
    const completed = dStops.filter(
      (s) => s.status === 'completed' || s.status === 'skipped',
    ).length;
    return {
      dispatch: d,
      routeCount: dRouteIds.length,
      totalStops: dStops.length,
      completedStops: completed,
    };
  });
}
