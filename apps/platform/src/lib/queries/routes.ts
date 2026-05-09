// Queries de routes. Server-only.
// Máquina de estados: DRAFT → OPTIMIZED → APPROVED → PUBLISHED → IN_PROGRESS → COMPLETED → CANCELLED.
// Las transiciones se exponen como funciones nombradas (no un setStatus genérico).

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { Route, RouteStatus } from '@verdfrut/types';

interface RouteRow {
  id: string;
  name: string;
  date: string;
  vehicle_id: string;
  driver_id: string | null;
  zone_id: string;
  status: RouteStatus;
  version: number;
  total_distance_meters: number | null;
  total_duration_seconds: number | null;
  estimated_start_at: string | null;
  estimated_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  published_at: string | null;
  published_by: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  dispatch_id: string | null;
}

const ROUTE_COLS = `
  id, name, date, vehicle_id, driver_id, zone_id, status, version,
  total_distance_meters, total_duration_seconds, estimated_start_at, estimated_end_at,
  actual_start_at, actual_end_at, published_at, published_by, approved_at, approved_by,
  created_by, created_at, updated_at, dispatch_id
`;

function toRoute(row: RouteRow): Route {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    vehicleId: row.vehicle_id,
    driverId: row.driver_id,
    zoneId: row.zone_id,
    status: row.status,
    version: row.version,
    totalDistanceMeters: row.total_distance_meters,
    totalDurationSeconds: row.total_duration_seconds,
    estimatedStartAt: row.estimated_start_at,
    estimatedEndAt: row.estimated_end_at,
    actualStartAt: row.actual_start_at,
    actualEndAt: row.actual_end_at,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    dispatchId: row.dispatch_id,
  };
}

/**
 * Default page size — balance entre densidad UI y costo de query.
 */
export const ROUTES_PAGE_SIZE = 50;

export async function listRoutes(opts?: {
  date?: string;
  zoneId?: string;
  status?: RouteStatus | RouteStatus[];
  driverId?: string;
  /** ADR-040: filtrar por tiro (dispatch). Útil para `listRoutesByDispatch`. */
  dispatchId?: string;
  /** 0-indexed offset para paginación. Default 0. */
  offset?: number;
  /** Máximo de filas a devolver. Default ROUTES_PAGE_SIZE. */
  limit?: number;
}): Promise<{ rows: Route[]; total: number }> {
  const supabase = await createServerClient();
  const limit = opts?.limit ?? ROUTES_PAGE_SIZE;
  const offset = opts?.offset ?? 0;

  let q = supabase
    .from('routes')
    .select(ROUTE_COLS, { count: 'exact' })
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.date) q = q.eq('date', opts.date);
  if (opts?.zoneId) q = q.eq('zone_id', opts.zoneId);
  if (opts?.status) {
    q = Array.isArray(opts.status) ? q.in('status', opts.status) : q.eq('status', opts.status);
  }
  if (opts?.driverId) q = q.eq('driver_id', opts.driverId);
  if (opts?.dispatchId) q = q.eq('dispatch_id', opts.dispatchId);

  const { data, error, count } = await q;
  if (error) throw new Error(`[routes.list] ${error.message}`);
  return {
    rows: (data ?? []).map(toRoute),
    total: count ?? 0,
  };
}

/**
 * Devuelve un Map: routeId → { total, completed } de sus stops.
 * Útil para mostrar "8/13" en la lista de rutas sin hacer N+1 queries.
 */
export async function countStopsForRoutes(
  routeIds: string[],
): Promise<Map<string, { total: number; completed: number }>> {
  if (routeIds.length === 0) return new Map();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('stops')
    .select('route_id, status')
    .in('route_id', routeIds);

  if (error) throw new Error(`[routes.countStops] ${error.message}`);

  const map = new Map<string, { total: number; completed: number }>();
  for (const row of (data ?? []) as Array<{ route_id: string; status: string }>) {
    const entry = map.get(row.route_id) ?? { total: 0, completed: 0 };
    entry.total += 1;
    if (row.status === 'completed') entry.completed += 1;
    map.set(row.route_id, entry);
  }
  return map;
}

export async function getRoute(id: string): Promise<Route | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.from('routes').select(ROUTE_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(`[routes.get] ${error.message}`);
  return data ? toRoute(data) : null;
}

interface CreateRouteInput {
  name: string;
  date: string;
  vehicleId: string;
  driverId?: string | null;
  zoneId: string;
  createdBy: string;
  /** Opcional — agrupa esta ruta dentro de un tiro. ADR-024. */
  dispatchId?: string | null;
}

export async function createDraftRoute(input: CreateRouteInput): Promise<Route> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('routes')
    .insert({
      name: input.name,
      date: input.date,
      vehicle_id: input.vehicleId,
      driver_id: input.driverId ?? null,
      zone_id: input.zoneId,
      status: 'DRAFT',
      created_by: input.createdBy,
      dispatch_id: input.dispatchId ?? null,
    })
    .select(ROUTE_COLS)
    .single();

  if (error) {
    // Constraint UNIQUE(vehicle_id, date) cuando is_active — protege contra
    // doble asignación del mismo camión el mismo día. Mensaje user-friendly:
    if (error.code === '23505' && error.message.includes('idx_routes_vehicle_date_active')) {
      throw new Error(
        `Ya existe una ruta activa para este camión el ${input.date}. ` +
        `Cancela la anterior o asigna otro camión.`,
      );
    }
    throw new Error(`[routes.createDraft] ${error.message}`);
  }
  return toRoute(data);
}

/**
 * Persiste resultados del optimizador en la ruta.
 * Cambia status DRAFT → OPTIMIZED.
 */
export async function markRouteOptimized(
  id: string,
  metrics: { totalDistanceMeters: number; totalDurationSeconds: number; estimatedStartAt: string; estimatedEndAt: string },
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({
      status: 'OPTIMIZED',
      total_distance_meters: metrics.totalDistanceMeters,
      total_duration_seconds: metrics.totalDurationSeconds,
      estimated_start_at: metrics.estimatedStartAt,
      estimated_end_at: metrics.estimatedEndAt,
    })
    .eq('id', id);

  if (error) throw new Error(`[routes.markOptimized] ${error.message}`);
}

/**
 * OPTIMIZED → APPROVED.
 */
export async function approveRoute(id: string, approvedBy: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({
      status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    })
    .eq('id', id)
    .eq('status', 'OPTIMIZED');

  if (error) throw new Error(`[routes.approve] ${error.message}`);
}

/**
 * APPROVED → PUBLISHED. La notificación push al chofer se dispara aparte (después).
 */
export async function publishRoute(id: string, publishedBy: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({
      status: 'PUBLISHED',
      published_at: new Date().toISOString(),
      published_by: publishedBy,
    })
    .eq('id', id)
    .eq('status', 'APPROVED');

  if (error) throw new Error(`[routes.publish] ${error.message}`);
}

/**
 * Cancela una ruta. Solo válido en DRAFT, OPTIMIZED o APPROVED.
 * Para rutas PUBLISHED en adelante, usar otro flujo (con audit + push).
 */
export async function cancelRoute(id: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({ status: 'CANCELLED' })
    .eq('id', id)
    .in('status', ['DRAFT', 'OPTIMIZED', 'APPROVED']);

  if (error) throw new Error(`[routes.cancel] ${error.message}`);
}

/**
 * Resetea una ruta OPTIMIZED|APPROVED a DRAFT y limpia métricas.
 * Usado por re-optimización para empezar fresco antes de re-correr el optimizer.
 * NO permite resetear rutas PUBLISHED+ (esas requieren versión nueva).
 */
export async function resetRouteToDraft(id: string): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({
      status: 'DRAFT',
      total_distance_meters: null,
      total_duration_seconds: null,
      estimated_start_at: null,
      estimated_end_at: null,
      approved_at: null,
      approved_by: null,
    })
    .eq('id', id)
    .in('status', ['OPTIMIZED', 'APPROVED']);

  if (error) throw new Error(`[routes.resetToDraft] ${error.message}`);
}

/**
 * Bumpa la versión de la ruta y crea una entrada en `route_versions` con la razón.
 * Usado tras cambios post-publicación (ADR-035): admin reorder en PUBLISHED/IN_PROGRESS
 * o chofer reorder. La razón queda en audit para reconstruir el historial.
 *
 * Nota: la versión se bumpa SIEMPRE incluso si la ruta está en estado pre-publish.
 * El caller decide cuándo invocar esto. Para reorder pre-publish típico no se llama
 * (solo si quiere preservar audit explícito).
 */
export async function incrementRouteVersion(
  id: string,
  userId: string,
  reason: string,
): Promise<number> {
  const supabase = await createServerClient();

  // 1. Bump la versión (UPDATE … RETURNING) — atomicidad por row.
  const { data: row, error: bumpErr } = await supabase
    .from('routes')
    .update({ version: undefined })  // dummy — actualizamos via SQL raw abajo
    .eq('id', id)
    .select('version')
    .single();
  // El cliente Supabase JS no expone "version + 1" en client side simple;
  // hacemos un round-trip: leemos versión actual, luego escribimos +1.
  // Trade-off aceptable porque admins son <10 concurrentes.
  if (bumpErr || !row) throw new Error(`[routes.incrementVersion] read: ${bumpErr?.message}`);

  const nextVersion = (row.version as number) + 1;
  const { error: writeErr } = await supabase
    .from('routes')
    .update({ version: nextVersion, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (writeErr) throw new Error(`[routes.incrementVersion] write: ${writeErr.message}`);

  // 2. Audit en route_versions.
  const { error: auditErr } = await supabase
    .from('route_versions')
    .insert({
      route_id: id,
      version: nextVersion,
      reason,
      created_by: userId,
    });
  if (auditErr) {
    // Audit failure NO debe romper la operación principal — solo loggear.
    console.error('[routes.incrementVersion] audit failed:', auditErr);
  }

  return nextVersion;
}

/**
 * Asigna o desasigna un chofer a una ruta.
 * Solo permitido en estados pre-publicación (DRAFT, OPTIMIZED, APPROVED).
 * Pasar null para desasignar.
 */
export async function assignDriverToRoute(
  id: string,
  driverId: string | null,
): Promise<void> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('routes')
    .update({ driver_id: driverId })
    .eq('id', id)
    .in('status', ['DRAFT', 'OPTIMIZED', 'APPROVED']);

  if (error) throw new Error(`[routes.assignDriver] ${error.message}`);
}
