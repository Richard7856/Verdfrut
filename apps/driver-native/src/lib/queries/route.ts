// Queries de la ruta del día del chofer (versión native).
//
// Por qué duplicado (no compartido con el web driver):
//   El client de Supabase es distinto (anon-key + AsyncStorage vs cookies SSR).
//   Cuando N3-N5 cierren veremos qué realmente vale la pena abstraer a un package.
//
// RLS hace el filtro real: la policy `routes_select` para role=driver restringe
// a sus propias rutas. Por eso acá NO filtramos por driver_id — confiamos en RLS
// y filtramos por fecha + status.

import type { Depot, Route, RouteStatus, Stop, StopStatus, Store } from '@tripdrive/types';
import { supabase } from '@/lib/supabase';

// ─── Tipos row internos ────────────────────────────────────────────────────

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
  depot_override_id: string | null;
}

const ROUTE_COLS = `
  id, name, date, vehicle_id, driver_id, zone_id, status, version,
  total_distance_meters, total_duration_seconds, estimated_start_at, estimated_end_at,
  actual_start_at, actual_end_at, published_at, published_by, approved_at, approved_by,
  created_by, created_at, updated_at, dispatch_id, depot_override_id
`;

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
  coord_verified: boolean | null;
  created_at: string;
}

interface DepotRow {
  id: string;
  zone_id: string;
  code: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  contact_name: string | null;
  contact_phone: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: string;
}

// ─── Mappers row → domain ──────────────────────────────────────────────────

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
    depotOverrideId: row.depot_override_id,
  };
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
    coordVerified: row.coord_verified ?? false,
    createdAt: row.created_at,
  };
}

function toDepot(row: DepotRow): Depot {
  return {
    id: row.id,
    zoneId: row.zone_id,
    code: row.code,
    name: row.name,
    address: row.address,
    lat: row.lat,
    lng: row.lng,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
}

// ─── API pública ───────────────────────────────────────────────────────────

export interface StopWithStore {
  stop: Stop;
  store: Store;
}

/**
 * Bundle completo de la ruta del día — todo lo que la pantalla `/route` necesita.
 * Estructura plana para que sea JSON-serializable (cache en AsyncStorage).
 */
export interface RouteBundle {
  route: Route;
  stops: StopWithStore[];
  /** Depot de salida (override o el del vehículo). NULL si no se puede resolver. */
  depot: Depot | null;
  /** drivers.id del usuario actual — usado para breadcrumbs/broadcast. */
  driverId: string | null;
}

/**
 * Devuelve la ruta más relevante para el chofer hoy. Misma lógica que en web:
 *   1. IN_PROGRESS — ya empezó.
 *   2. PUBLISHED con date >= hoy — la más próxima.
 *   3. null — sin ruta.
 *
 * RLS restringe a las rutas del chofer; no filtramos por driver_id explícito.
 */
export async function getDriverRouteForDate(date: string): Promise<Route | null> {
  const [inProgressRes, publishedRes] = await Promise.all([
    supabase
      .from('routes')
      .select(ROUTE_COLS)
      .eq('status', 'IN_PROGRESS')
      .order('date', { ascending: true })
      .limit(1),
    supabase
      .from('routes')
      .select(ROUTE_COLS)
      .eq('status', 'PUBLISHED')
      .gte('date', date)
      .order('date', { ascending: true })
      .order('updated_at', { ascending: false })
      .limit(1),
  ]);

  if (inProgressRes.error) {
    throw new Error(`[driver-native.routes.forDate] in_progress: ${inProgressRes.error.message}`);
  }
  if (publishedRes.error) {
    throw new Error(`[driver-native.routes.forDate] published: ${publishedRes.error.message}`);
  }

  const inProgress = (inProgressRes.data ?? [])[0] as RouteRow | undefined;
  if (inProgress) return toRoute(inProgress);

  const next = (publishedRes.data ?? [])[0] as RouteRow | undefined;
  if (next) return toRoute(next);

  return null;
}

/**
 * Paradas de la ruta + tienda joineada. Ordenadas por sequence.
 * Dos queries (no JOIN nativo en supabase-js) — N esperado < 50, no optimizamos.
 */
export async function getRouteStopsWithStores(routeId: string): Promise<StopWithStore[]> {
  const { data: stopsData, error: stopsErr } = await supabase
    .from('stops')
    .select(
      `id, route_id, store_id, sequence, status,
       planned_arrival_at, planned_departure_at, actual_arrival_at, actual_departure_at,
       load, notes, created_at`,
    )
    .eq('route_id', routeId)
    .order('sequence');

  if (stopsErr) throw new Error(`[driver-native.stops.forRoute] ${stopsErr.message}`);

  const stops = (stopsData ?? []) as StopRow[];
  if (stops.length === 0) return [];

  const storeIds = Array.from(new Set(stops.map((s) => s.store_id)));
  const { data: storesData, error: storesErr } = await supabase
    .from('stores')
    .select(
      `id, code, name, zone_id, address, lat, lng, contact_name, contact_phone,
       receiving_window_start, receiving_window_end, service_time_seconds, demand,
       is_active, coord_verified, created_at`,
    )
    .in('id', storeIds);

  if (storesErr) throw new Error(`[driver-native.stores.byIds] ${storesErr.message}`);

  const storesById = new Map(
    (storesData ?? []).map((s) => [(s as StoreRow).id, toStore(s as StoreRow)]),
  );

  // Si una tienda no aparece (RLS bloqueó / desactivada), salteamos esa parada.
  // El web warning aquí — en native un console.warn ayuda en dev.
  const result: StopWithStore[] = [];
  for (const row of stops) {
    const store = storesById.get(row.store_id);
    if (!store) {
      console.warn(`[driver-native.stops.forRoute] Stop ${row.id} sin store visible`);
      continue;
    }
    result.push({ stop: toStop(row), store });
  }
  return result;
}

/**
 * Depot de salida para una ruta:
 *   - Si `route.depotOverrideId` está set, usa ese (ADR-047).
 *   - Si no, lee `vehicle.depot_id` y carga ese depot.
 *
 * Puede devolver null si el vehículo no tiene depot asignado (config incompleta
 * del tenant). En ese caso el mapa no muestra pin de CEDIS, sólo paradas.
 */
export async function getRouteDepot(route: Route): Promise<Depot | null> {
  let depotId: string | null = route.depotOverrideId;

  if (!depotId) {
    const { data: vehicleData, error: vehErr } = await supabase
      .from('vehicles')
      .select('depot_id')
      .eq('id', route.vehicleId)
      .maybeSingle();

    if (vehErr) {
      throw new Error(`[driver-native.routes.depot.vehicle] ${vehErr.message}`);
    }
    depotId = (vehicleData as { depot_id: string | null } | null)?.depot_id ?? null;
  }

  if (!depotId) return null;

  const { data, error } = await supabase
    .from('depots')
    .select(
      'id, zone_id, code, name, address, lat, lng, contact_name, contact_phone, notes, is_active, created_at',
    )
    .eq('id', depotId)
    .maybeSingle();

  if (error) throw new Error(`[driver-native.routes.depot.get] ${error.message}`);
  return data ? toDepot(data as DepotRow) : null;
}

/**
 * Bundle completo: ruta + paradas + depot. Si no hay ruta, devuelve null
 * (no las paradas vacías) — la UI distingue "sin ruta hoy" vs "ruta sin paradas".
 */
async function resolveDriverId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return null;
  const { data, error } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.warn('[driver-native.routes.driverId] resolve falló:', error.message);
    return null;
  }
  return (data as { id: string } | null)?.id ?? null;
}

export async function getDriverRouteBundle(date: string): Promise<RouteBundle | null> {
  const route = await getDriverRouteForDate(date);
  if (!route) return null;

  const [stops, depot, driverId] = await Promise.all([
    getRouteStopsWithStores(route.id),
    getRouteDepot(route),
    resolveDriverId(),
  ]);

  return { route, stops, depot, driverId };
}
