// Queries de dispatches (tiros). ADR-024.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { Dispatch, DispatchStatus, Route } from '@tripdrive/types';
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
  public_share_token: string | null;
}

const DISPATCH_COLS =
  'id, name, date, zone_id, status, notes, created_by, created_at, updated_at, public_share_token';

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
    publicShareToken: row.public_share_token,
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
 *
 * Bug previo: la implementación pedía las N rutas MÁS RECIENTES de la BD
 * vía `listRoutes({ limit: ids.length })` y filtraba por id en cliente.
 * Si entre crear y consultar aparecía otra ruta más reciente (otro tiro,
 * otro día), el filter devolvía menos rutas o cero. Resultado para el user:
 * "el tiro tiene 0 rutas" cuando en realidad la BD las tenía.
 *
 * Fix: usar el filtro `dispatchId` que agregamos a listRoutes (filtra en
 * Postgres, no en cliente). Limit alto (200) cubre cualquier tiro razonable.
 */
export async function listRoutesByDispatch(dispatchId: string): Promise<Route[]> {
  const { rows } = await listRoutes({ dispatchId, limit: 200 });
  return rows;
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

/**
 * ADR-046: lookup público de dispatch por token. Usado por /share/dispatch/[token].
 * Usa service_role para bypass de RLS — el visitante anónimo no tiene sesión.
 * NULL si el token no existe o el dispatch no tiene `public_share_token` set.
 */
export async function getDispatchByPublicToken(token: string): Promise<Dispatch | null> {
  // Validación básica del UUID antes de query (defensa contra tokens malformados).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return null;
  }
  // service_role bypass RLS — necesario para vista pública (sin sesión).
  const { createServiceRoleClient } = await import('@tripdrive/supabase/server');
  const admin = createServiceRoleClient();
  const { data, error } = await admin
    .from('dispatches')
    .select(DISPATCH_COLS)
    .eq('public_share_token', token)
    .maybeSingle();
  if (error || !data) return null;
  return toDispatch(data as DispatchRow);
}

/**
 * ADR-046: habilita compartir el dispatch generando un nuevo token UUID.
 * Si ya tenía token, lo regenera (revoca enlaces previos).
 */
export async function enableDispatchSharing(dispatchId: string): Promise<string> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('dispatches')
    .update({ public_share_token: crypto.randomUUID() })
    .eq('id', dispatchId)
    .select('public_share_token')
    .single();
  if (error || !data?.public_share_token) {
    throw new Error(`[dispatches.enableSharing] ${error?.message ?? 'no token'}`);
  }
  return data.public_share_token as string;
}

/**
 * ADR-046: revoca el enlace público (set NULL). Cualquier persona con el link
 * viejo deja de tener acceso inmediatamente.
 */
export async function disableDispatchSharing(dispatchId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispatches')
    .update({ public_share_token: null })
    .eq('id', dispatchId);
  if (error) throw new Error(`[dispatches.disableSharing] ${error.message}`);
}
