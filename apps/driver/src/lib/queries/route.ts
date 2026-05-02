// Queries que la driver app hace para obtener LA ruta del chofer del día.
// Server-only — usan la sesión del chofer (RLS respeta cuál ruta puede ver).
//
// Importante: la RLS policy `routes_select` para drivers SÓLO devuelve rutas
// con status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED') Y donde driver_id
// coincide con el driver row del usuario. Por eso no filtramos por status aquí —
// confiamos en RLS y filtramos por la fecha.

import 'server-only';
import { createServerClient } from '@verdfrut/supabase/server';
import type { Route, Stop, Store, RouteStatus, StopStatus } from '@verdfrut/types';

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
}

const ROUTE_COLS = `
  id, name, date, vehicle_id, driver_id, zone_id, status, version,
  total_distance_meters, total_duration_seconds, estimated_start_at, estimated_end_at,
  actual_start_at, actual_end_at, published_at, published_by, approved_at, approved_by,
  created_by, created_at, updated_at
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
  };
}

/**
 * Devuelve la ruta del chofer para una fecha dada, o null si no tiene asignada.
 * Si por alguna razón hay >1 (no debería por UNIQUE constraint), devuelve la
 * más reciente y loggea warning — los datos están corruptos.
 *
 * El chofer solo verá rutas PUBLISHED+ por RLS. Si está en estado IN_PROGRESS
 * la app debe permitir continuar; si COMPLETED, solo lectura.
 */
export async function getDriverRouteForDate(date: string): Promise<Route | null> {
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('routes')
    .select(ROUTE_COLS)
    .eq('date', date)
    .order('updated_at', { ascending: false })
    .limit(2);

  if (error) throw new Error(`[driver.routes.forDate] ${error.message}`);

  const rows = (data ?? []) as RouteRow[];
  const first = rows[0];
  if (!first) return null;
  if (rows.length > 1) {
    console.warn(
      `[driver.routes.forDate] Chofer tiene ${rows.length} rutas el ${date} — usando la más reciente.`,
      rows.map((r) => r.id),
    );
  }
  return toRoute(first);
}

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

interface StoreRow {
  id: string;
  code: string;
  name: string;
  zone_id: string;
  address: string;
  lat: number;
  lng: number;
  contact_name: string | null;
  contact_phone: string | null;
  receiving_window_start: string | null;
  receiving_window_end: string | null;
  service_time_seconds: number;
  demand: number[];
  is_active: boolean;
  created_at: string;
}

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

function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    zoneId: row.zone_id,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    receivingWindowStart: row.receiving_window_start,
    receivingWindowEnd: row.receiving_window_end,
    serviceTimeSeconds: row.service_time_seconds,
    demand: row.demand,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

export interface StopWithStore {
  stop: Stop;
  store: Store;
}

/**
 * Devuelve las paradas de una ruta con la info de la tienda joineada.
 * Ordenadas por sequence.
 *
 * Hace dos queries (no JOIN nativo en supabase-js) para mantener tipos limpios.
 * El N esperado es bajo (10-50 paradas por ruta) — no merece optimización.
 */
export async function getRouteStopsWithStores(routeId: string): Promise<StopWithStore[]> {
  const supabase = await createServerClient();

  const { data: stopsData, error: stopsErr } = await supabase
    .from('stops')
    .select(
      `id, route_id, store_id, sequence, status,
       planned_arrival_at, planned_departure_at, actual_arrival_at, actual_departure_at,
       load, notes, created_at`,
    )
    .eq('route_id', routeId)
    .order('sequence');

  if (stopsErr) throw new Error(`[driver.stops.forRoute] ${stopsErr.message}`);

  const stops = (stopsData ?? []) as StopRow[];
  if (stops.length === 0) return [];

  const storeIds = Array.from(new Set(stops.map((s) => s.store_id)));
  const { data: storesData, error: storesErr } = await supabase
    .from('stores')
    .select(
      `id, code, name, zone_id, address, lat, lng, contact_name, contact_phone,
       receiving_window_start, receiving_window_end, service_time_seconds, demand, is_active, created_at`,
    )
    .in('id', storeIds);

  if (storesErr) throw new Error(`[driver.stores.byIds] ${storesErr.message}`);

  const storesById = new Map((storesData ?? []).map((s) => [(s as StoreRow).id, toStore(s as StoreRow)]));

  // Si una tienda no aparece (RLS bloqueó o fue desactivada) la salteamos.
  // El chofer ve la parada pero sin info de tienda — caso edge a manejar en UI.
  const result: StopWithStore[] = [];
  for (const row of stops) {
    const store = storesById.get(row.store_id);
    if (!store) {
      console.warn(`[driver.stops.forRoute] Stop ${row.id} sin store visible (id=${row.store_id})`);
      continue;
    }
    result.push({ stop: toStop(row), store });
  }

  return result;
}
