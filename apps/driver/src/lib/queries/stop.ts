// Queries del detalle de una parada para el driver app.
// Server-only — RLS aplica con la sesión del chofer.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';
import type { Stop, Store, Route, DeliveryReport } from '@tripdrive/types';
import { mapDeliveryReport } from './report';

export interface StopContext {
  stop: Stop;
  store: Store;
  route: Route;
  /** Reporte en curso para esta parada. Null si el chofer no ha iniciado el flujo. */
  report: DeliveryReport | null;
  /** Driver row del usuario actual (id, no user_id). Útil para insert/update. */
  driverId: string;
}

/**
 * Devuelve toda la info necesaria para renderizar /route/stop/[id]:
 *   - Stop
 *   - Store (joineada)
 *   - Route (a la que pertenece, para validar PUBLISHED/IN_PROGRESS)
 *   - DeliveryReport en curso si existe (one-to-one con stop)
 *   - driverId del chofer actual
 *
 * Devuelve null si el stop no existe o no es visible para el chofer (RLS).
 */
export async function getStopContext(stopId: string): Promise<StopContext | null> {
  const supabase = await createServerClient();

  // 1. Resolver el driver_id del chofer actual.
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data: driverRow, error: driverErr } = await supabase
    .from('drivers')
    .select('id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (driverErr) throw new Error(`[stop.context] driver: ${driverErr.message}`);
  if (!driverRow) return null;

  // 2. Stop + store en paralelo. RLS filtra automáticamente si no le toca.
  const { data: stopRow, error: stopErr } = await supabase
    .from('stops')
    .select(
      `id, route_id, store_id, sequence, status,
       planned_arrival_at, planned_departure_at, actual_arrival_at, actual_departure_at,
       load, notes, created_at`,
    )
    .eq('id', stopId)
    .maybeSingle();
  if (stopErr) throw new Error(`[stop.context] stop: ${stopErr.message}`);
  if (!stopRow) return null;

  const [storeRes, routeRes, reportRes] = await Promise.all([
    supabase
      .from('stores')
      .select(
        `id, code, name, zone_id, address, lat, lng, contact_name, contact_phone,
         receiving_window_start, receiving_window_end, service_time_seconds, demand, is_active, coord_verified, created_at`,
      )
      .eq('id', stopRow.store_id)
      .maybeSingle(),
    supabase
      .from('routes')
      .select(
        `id, name, date, vehicle_id, driver_id, zone_id, status, version,
         total_distance_meters, total_duration_seconds, estimated_start_at, estimated_end_at,
         actual_start_at, actual_end_at, published_at, published_by, approved_at, approved_by,
         created_by, created_at, updated_at, dispatch_id`,
      )
      .eq('id', stopRow.route_id)
      .maybeSingle(),
    supabase
      .from('delivery_reports')
      .select('*')
      .eq('stop_id', stopId)
      .maybeSingle(),
  ]);

  if (storeRes.error) throw new Error(`[stop.context] store: ${storeRes.error.message}`);
  if (routeRes.error) throw new Error(`[stop.context] route: ${routeRes.error.message}`);
  if (reportRes.error) throw new Error(`[stop.context] report: ${reportRes.error.message}`);
  if (!storeRes.data || !routeRes.data) return null;

  return {
    stop: {
      id: stopRow.id,
      routeId: stopRow.route_id,
      storeId: stopRow.store_id,
      sequence: stopRow.sequence,
      status: stopRow.status,
      plannedArrivalAt: stopRow.planned_arrival_at,
      plannedDepartureAt: stopRow.planned_departure_at,
      actualArrivalAt: stopRow.actual_arrival_at,
      actualDepartureAt: stopRow.actual_departure_at,
      load: stopRow.load,
      notes: stopRow.notes,
      createdAt: stopRow.created_at,
    },
    store: {
      id: storeRes.data.id,
      code: storeRes.data.code,
      name: storeRes.data.name,
      zoneId: storeRes.data.zone_id,
      address: storeRes.data.address,
      lat: storeRes.data.lat,
      lng: storeRes.data.lng,
      contactName: storeRes.data.contact_name,
      contactPhone: storeRes.data.contact_phone,
      receivingWindowStart: storeRes.data.receiving_window_start,
      receivingWindowEnd: storeRes.data.receiving_window_end,
      serviceTimeSeconds: storeRes.data.service_time_seconds,
      demand: storeRes.data.demand,
      isActive: storeRes.data.is_active,
      coordVerified: storeRes.data.coord_verified ?? false,
      createdAt: storeRes.data.created_at,
    },
    route: {
      id: routeRes.data.id,
      name: routeRes.data.name,
      date: routeRes.data.date,
      vehicleId: routeRes.data.vehicle_id,
      driverId: routeRes.data.driver_id,
      zoneId: routeRes.data.zone_id,
      status: routeRes.data.status,
      version: routeRes.data.version,
      totalDistanceMeters: routeRes.data.total_distance_meters,
      totalDurationSeconds: routeRes.data.total_duration_seconds,
      estimatedStartAt: routeRes.data.estimated_start_at,
      estimatedEndAt: routeRes.data.estimated_end_at,
      actualStartAt: routeRes.data.actual_start_at,
      actualEndAt: routeRes.data.actual_end_at,
      publishedAt: routeRes.data.published_at,
      publishedBy: routeRes.data.published_by,
      approvedAt: routeRes.data.approved_at,
      approvedBy: routeRes.data.approved_by,
      createdBy: routeRes.data.created_by,
      createdAt: routeRes.data.created_at,
      updatedAt: routeRes.data.updated_at,
      dispatchId: routeRes.data.dispatch_id ?? null,
      depotOverrideId: (routeRes.data as { depot_override_id?: string | null }).depot_override_id ?? null,
    },
    report: reportRes.data ? mapDeliveryReport(reportRes.data) : null,
    driverId: driverRow.id,
  };
}
