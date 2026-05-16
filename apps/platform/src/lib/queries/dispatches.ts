// Queries de dispatches (tiros). ADR-024.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { Dispatch, DispatchStatus, Route } from '@tripdrive/types';
import { listRoutes } from './routes';
import { isSandboxMode } from '@/lib/workbench-mode';

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
  public_share_expires_at: string | null;
}

const DISPATCH_COLS =
  'id, name, date, zone_id, status, notes, created_by, created_at, updated_at, public_share_token, public_share_expires_at';

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
    publicShareExpiresAt: row.public_share_expires_at,
  };
}

export async function listDispatches(opts?: {
  date?: string;
  zoneId?: string;
  /** ADR-112: override del modo Workbench. Default: cookie del request. */
  sandbox?: boolean;
}): Promise<Dispatch[]> {
  const supabase = await createServerClient();
  const sandbox = opts?.sandbox ?? (await isSandboxMode());
  let q = supabase
    .from('dispatches')
    .select(DISPATCH_COLS)
    .eq('is_sandbox', sandbox)
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
 * ADR-046 / HARDENING C2: lookup público de dispatch por token.
 *
 * Usado por /share/dispatch/[token]. service_role bypass RLS — el
 * visitante anónimo no tiene sesión.
 *
 * Devuelve NULL si:
 *   - el token no existe o el dispatch no tiene `public_share_token` set.
 *   - el link expiró (`public_share_expires_at` <= NOW()).
 *   - el dispatch está `completed` o `cancelled` (no tiene sentido seguir
 *     mostrando rutas históricas con coordenadas vivas).
 */
export async function getDispatchByPublicToken(token: string): Promise<Dispatch | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return null;
  }
  const { createServiceRoleClient } = await import('@tripdrive/supabase/server');
  const admin = createServiceRoleClient();
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('dispatches')
    .select(DISPATCH_COLS)
    .eq('public_share_token', token)
    // ADR-112: sandbox NUNCA debe filtrarse via share token (es operación
    // hipotética del admin, no visible al cliente externo).
    .eq('is_sandbox', false)
    .gt('public_share_expires_at', nowIso)
    .not('status', 'in', '(completed,cancelled)')
    .maybeSingle();
  if (error || !data) return null;
  return toDispatch(data as DispatchRow);
}

/** Default TTL para nuevos shares: 7 días. */
const SHARE_DEFAULT_TTL_DAYS = 7;

/**
 * ADR-046 / HARDENING C2: habilita compartir el dispatch.
 *
 * Genera un nuevo UUID + expira el link a `now() + ttlDays` (default 7).
 * Si ya tenía token, lo regenera (revoca enlaces previos al cambiar el
 * token); el expiry también se resetea al nuevo TTL.
 *
 * Para ampliar el plazo en el futuro, llamar de nuevo con un `ttlDays`
 * más largo — siempre se sobrescribe el expiry, no se acumula.
 */
export async function enableDispatchSharing(
  dispatchId: string,
  ttlDays: number = SHARE_DEFAULT_TTL_DAYS,
): Promise<{ token: string; expiresAt: string }> {
  const supabase = await createServerClient();
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('dispatches')
    .update({
      public_share_token: crypto.randomUUID(),
      public_share_expires_at: expiresAt,
    })
    .eq('id', dispatchId)
    .select('public_share_token, public_share_expires_at')
    .single();
  if (error || !data?.public_share_token || !data.public_share_expires_at) {
    throw new Error(`[dispatches.enableSharing] ${error?.message ?? 'no token'}`);
  }
  return {
    token: data.public_share_token as string,
    expiresAt: data.public_share_expires_at as string,
  };
}

/**
 * ADR-046: revoca el enlace público (set NULL en token y expires_at).
 * Cualquier persona con el link viejo deja de tener acceso inmediatamente.
 */
export async function disableDispatchSharing(dispatchId: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('dispatches')
    .update({
      public_share_token: null,
      public_share_expires_at: null,
    })
    .eq('id', dispatchId);
  if (error) throw new Error(`[dispatches.disableSharing] ${error.message}`);
}
