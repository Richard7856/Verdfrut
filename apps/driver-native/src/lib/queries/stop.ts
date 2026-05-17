// Query del detalle de una parada — stop + store + route (mínimo necesario
// para la pantalla `/stop/[id]`).
//
// Hace 3 reads, no JOIN. RLS restringe a la ruta del chofer.

import type { Route, Stop, Store } from '@tripdrive/types';
import { supabase } from '@/lib/supabase';

export interface StopContext {
  stop: Stop;
  store: Store;
  route: Route;
  /** Resuelve a `drivers.id` del usuario actual — necesario para insertar breadcrumbs. */
  driverId: string | null;
}

interface StopRow {
  id: string;
  route_id: string;
  store_id: string;
  sequence: number;
  status: Stop['status'];
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

interface RouteRow {
  id: string;
  name: string;
  date: string;
  vehicle_id: string;
  driver_id: string | null;
  zone_id: string;
  status: Route['status'];
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

export async function getStopContext(stopId: string): Promise<StopContext | null> {
  // Read 1: stop
  const { data: stopData, error: stopErr } = await supabase
    .from('stops')
    .select(
      `id, route_id, store_id, sequence, status,
       planned_arrival_at, planned_departure_at, actual_arrival_at, actual_departure_at,
       load, notes, created_at`,
    )
    .eq('id', stopId)
    .maybeSingle();
  if (stopErr) throw new Error(`[stop.ctx] stop: ${stopErr.message}`);
  if (!stopData) return null;
  const stop = stopData as StopRow;

  // Read 2 + 3 en paralelo: store + route
  const [storeRes, routeRes] = await Promise.all([
    supabase
      .from('stores')
      .select(
        `id, code, name, zone_id, address, lat, lng, contact_name, contact_phone,
         receiving_window_start, receiving_window_end, service_time_seconds, demand,
         is_active, coord_verified, created_at`,
      )
      .eq('id', stop.store_id)
      .maybeSingle(),
    supabase
      .from('routes')
      .select(
        `id, name, date, vehicle_id, driver_id, zone_id, status, version,
         total_distance_meters, total_duration_seconds, estimated_start_at, estimated_end_at,
         actual_start_at, actual_end_at, published_at, published_by, approved_at, approved_by,
         created_by, created_at, updated_at, dispatch_id, depot_override_id`,
      )
      .eq('id', stop.route_id)
      .maybeSingle(),
  ]);

  if (storeRes.error) throw new Error(`[stop.ctx] store: ${storeRes.error.message}`);
  if (routeRes.error) throw new Error(`[stop.ctx] route: ${routeRes.error.message}`);
  if (!storeRes.data || !routeRes.data) return null;

  const storeRow = storeRes.data as StoreRow;
  const routeRow = routeRes.data as RouteRow;

  // Resolver driver_id del usuario actual (necesario para breadcrumbs).
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  let driverId: string | null = null;
  if (userId) {
    const { data: driverRow } = await supabase
      .from('drivers')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();
    driverId = (driverRow as { id: string } | null)?.id ?? null;
  }

  return {
    stop: {
      id: stop.id,
      routeId: stop.route_id,
      storeId: stop.store_id,
      sequence: stop.sequence,
      suggestedSequence:
        (stop as { suggested_sequence?: number | null }).suggested_sequence ?? null,
      status: stop.status,
      plannedArrivalAt: stop.planned_arrival_at,
      plannedDepartureAt: stop.planned_departure_at,
      actualArrivalAt: stop.actual_arrival_at,
      actualDepartureAt: stop.actual_departure_at,
      load: stop.load,
      notes: stop.notes,
      createdAt: stop.created_at,
    },
    store: {
      id: storeRow.id,
      code: storeRow.code,
      name: storeRow.name,
      zoneId: storeRow.zone_id,
      address: storeRow.address,
      lat: storeRow.lat,
      lng: storeRow.lng,
      contactName: storeRow.contact_name,
      contactPhone: storeRow.contact_phone,
      receivingWindowStart: storeRow.receiving_window_start,
      receivingWindowEnd: storeRow.receiving_window_end,
      serviceTimeSeconds: storeRow.service_time_seconds,
      demand: storeRow.demand,
      isActive: storeRow.is_active,
      coordVerified: storeRow.coord_verified ?? false,
      createdAt: storeRow.created_at,
    },
    route: {
      id: routeRow.id,
      name: routeRow.name,
      date: routeRow.date,
      vehicleId: routeRow.vehicle_id,
      driverId: routeRow.driver_id,
      zoneId: routeRow.zone_id,
      status: routeRow.status,
      version: routeRow.version,
      totalDistanceMeters: routeRow.total_distance_meters,
      totalDurationSeconds: routeRow.total_duration_seconds,
      estimatedStartAt: routeRow.estimated_start_at,
      estimatedEndAt: routeRow.estimated_end_at,
      actualStartAt: routeRow.actual_start_at,
      actualEndAt: routeRow.actual_end_at,
      publishedAt: routeRow.published_at,
      publishedBy: routeRow.published_by,
      approvedAt: routeRow.approved_at,
      approvedBy: routeRow.approved_by,
      createdBy: routeRow.created_by,
      createdAt: routeRow.created_at,
      updatedAt: routeRow.updated_at,
      dispatchId: routeRow.dispatch_id,
      depotOverrideId: routeRow.depot_override_id,
      optimizationSkipped: (routeRow as { optimization_skipped?: boolean | null }).optimization_skipped ?? false,
      driverOrderConfirmedAt:
        (routeRow as { driver_order_confirmed_at?: string | null }).driver_order_confirmed_at ?? null,
    },
    driverId,
  };
}
