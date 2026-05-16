import 'server-only';

// Vista jerárquica de la operación de un día (Workbench WB-6 / ADR-118).
//
// Estructura: Día → Zona → Frecuencia → Camioneta → Ruta → Parada.
//
// La "Frecuencia" se INFIERE — no es entidad en BD. Para cada camioneta con
// ruta el `date` objetivo, miramos sus últimos 60 días de actividad y
// derivamos un pattern de día-de-semana (e.g. {Mon,Wed,Fri} → "Lun/Mié/Vie").
// Camionetas con el mismo pattern dentro de una zona se agrupan visualmente,
// dándole al admin un mental model de "qué grupos operativos tiene".

import { createServerClient } from '@tripdrive/supabase/server';

const PATTERN_WINDOW_DAYS = 60;

export interface HierarchyStop {
  id: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  sequence: number;
  status: string;
  load: number[];
  plannedArrivalAt: string | null;
}

export interface HierarchyRoute {
  id: string;
  name: string;
  status: string;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  stops: HierarchyStop[];
  totalStops: number;
  completedStops: number;
  totalKg: number;
}

export interface HierarchyVehicle {
  vehicleId: string;
  alias: string | null;
  plate: string;
  driverName: string | null;
  routes: HierarchyRoute[];
  totalStops: number;
  totalKg: number;
  totalDistanceMeters: number;
}

export interface HierarchyFrequencyGroup {
  /** Etiqueta legible: "Lun/Mié/Vie" o "Diaria" o "Ocasional". */
  label: string;
  /** Días específicos del pattern (0=Dom..6=Sáb) para tooltip. */
  daysOfWeek: number[];
  vehicles: HierarchyVehicle[];
  totalStops: number;
  totalKg: number;
}

export interface HierarchyZone {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  frequencyGroups: HierarchyFrequencyGroup[];
  totalStops: number;
  totalKg: number;
  totalDistanceMeters: number;
  vehicleCount: number;
}

export interface OperationHierarchy {
  date: string;
  zones: HierarchyZone[];
  totalStops: number;
  totalKg: number;
  totalDistanceMeters: number;
  routeCount: number;
  vehicleCount: number;
}

const DAY_ABBR = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;

function patternLabel(daysOfWeek: number[]): string {
  if (daysOfWeek.length === 0) return 'Sin patrón';
  if (daysOfWeek.length >= 6) return 'Diaria';
  if (daysOfWeek.length === 1) return `Solo ${DAY_ABBR[daysOfWeek[0]!]}`;
  const sorted = [...daysOfWeek].sort((a, b) => a - b);
  return sorted.map((d) => DAY_ABBR[d]).join('/');
}

export async function getOperationHierarchy(date: string): Promise<OperationHierarchy | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const supabase = await createServerClient();

  // 1. Rutas del día (no canceladas, no sandbox).
  const { data: routesRaw } = await supabase
    .from('routes')
    .select(
      'id, name, status, vehicle_id, driver_id, zone_id, total_distance_meters, total_duration_seconds',
    )
    .eq('date', date)
    .eq('is_sandbox', false)
    .neq('status', 'CANCELLED');
  type RouteRow = {
    id: string;
    name: string;
    status: string;
    vehicle_id: string;
    driver_id: string | null;
    zone_id: string;
    total_distance_meters: number | null;
    total_duration_seconds: number | null;
  };
  const routes = (routesRaw ?? []) as RouteRow[];

  if (routes.length === 0) {
    return {
      date,
      zones: [],
      totalStops: 0,
      totalKg: 0,
      totalDistanceMeters: 0,
      routeCount: 0,
      vehicleCount: 0,
    };
  }

  const routeIds = routes.map((r) => r.id);
  const vehicleIds = [...new Set(routes.map((r) => r.vehicle_id))];
  const driverIds = [
    ...new Set(
      routes.map((r) => r.driver_id).filter((id): id is string => id !== null),
    ),
  ];
  const zoneIds = [...new Set(routes.map((r) => r.zone_id))];

  // 2. Stops + stores en batch.
  const { data: stopsRaw } = await supabase
    .from('stops')
    .select(
      'id, route_id, store_id, sequence, status, load, planned_arrival_at',
    )
    .in('route_id', routeIds)
    .order('sequence');
  type StopRow = {
    id: string;
    route_id: string;
    store_id: string;
    sequence: number;
    status: string;
    load: number[];
    planned_arrival_at: string | null;
  };
  const stopRows = (stopsRaw ?? []) as StopRow[];

  const storeIds = [...new Set(stopRows.map((s) => s.store_id))];
  const { data: storesRaw } = storeIds.length > 0
    ? await supabase
        .from('stores')
        .select('id, code, name')
        .in('id', storeIds)
    : { data: [] as Array<{ id: string; code: string; name: string }> };
  const storesById = new Map(
    (storesRaw ?? []).map((s) => [s.id as string, { code: s.code as string, name: s.name as string }]),
  );

  // 3. Vehículos + zonas + drivers en batch.
  const [vehiclesRes, zonesRes, driversRes] = await Promise.all([
    supabase.from('vehicles').select('id, alias, plate').in('id', vehicleIds),
    supabase.from('zones').select('id, code, name').in('id', zoneIds),
    driverIds.length > 0
      ? supabase
          .from('drivers')
          .select('id, user_id, user_profiles!drivers_user_id_fkey(full_name)')
          .in('id', driverIds)
      : Promise.resolve({ data: [] as Array<unknown>, error: null }),
  ]);
  const vehicleById = new Map(
    (vehiclesRes.data ?? []).map((v) => [
      v.id as string,
      { alias: (v.alias as string | null) ?? null, plate: v.plate as string },
    ]),
  );
  const zoneById = new Map(
    (zonesRes.data ?? []).map((z) => [
      z.id as string,
      { code: z.code as string, name: z.name as string },
    ]),
  );
  type DriverRow = {
    id: string;
    user_profiles: { full_name: string } | null;
  };
  const driverNameById = new Map(
    ((driversRes.data ?? []) as unknown as DriverRow[]).map((d) => [
      d.id,
      d.user_profiles?.full_name ?? null,
    ]),
  );

  // 4. Inferir patrón de frecuencia por vehicleId. Una query batch para
  //    todos los vehículos del día sobre la ventana histórica.
  const targetDate = new Date(date + 'T00:00:00Z');
  const windowStart = new Date(targetDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - PATTERN_WINDOW_DAYS);
  const windowStartIso = windowStart.toISOString().slice(0, 10);

  const { data: historyRaw } = await supabase
    .from('routes')
    .select('vehicle_id, date')
    .in('vehicle_id', vehicleIds)
    .eq('is_sandbox', false)
    .gte('date', windowStartIso)
    .lte('date', date)
    .in('status', ['PUBLISHED', 'IN_PROGRESS', 'COMPLETED']);
  type HistoryRow = { vehicle_id: string; date: string };
  const history = (historyRaw ?? []) as HistoryRow[];

  const patternByVehicle = new Map<string, number[]>();
  for (const h of history) {
    const dow = new Date(h.date + 'T12:00:00Z').getUTCDay();
    const existing = patternByVehicle.get(h.vehicle_id) ?? [];
    if (!existing.includes(dow)) existing.push(dow);
    patternByVehicle.set(h.vehicle_id, existing);
  }

  // 5. Armar la jerarquía.
  const stopsByRouteId = new Map<string, HierarchyStop[]>();
  for (const s of stopRows) {
    const arr = stopsByRouteId.get(s.route_id) ?? [];
    const store = storesById.get(s.store_id);
    arr.push({
      id: s.id,
      storeId: s.store_id,
      storeCode: store?.code ?? '—',
      storeName: store?.name ?? '(tienda no encontrada)',
      sequence: s.sequence,
      status: s.status,
      load: s.load ?? [],
      plannedArrivalAt: s.planned_arrival_at,
    });
    stopsByRouteId.set(s.route_id, arr);
  }

  const hRoutes: HierarchyRoute[] = routes.map((r) => {
    const rStops = stopsByRouteId.get(r.id) ?? [];
    const completed = rStops.filter((s) => s.status === 'completed').length;
    const totalKg = rStops.reduce((sum, s) => sum + (Number(s.load?.[0] ?? 0) || 0), 0);
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      totalDistanceMeters: r.total_distance_meters,
      totalDurationSeconds: r.total_duration_seconds,
      stops: rStops,
      totalStops: rStops.length,
      completedStops: completed,
      totalKg,
    };
  });

  // Agrupar rutas por vehículo.
  const routesByVehicle = new Map<string, HierarchyRoute[]>();
  for (const r of hRoutes) {
    const route = routes.find((rr) => rr.id === r.id)!;
    const arr = routesByVehicle.get(route.vehicle_id) ?? [];
    arr.push(r);
    routesByVehicle.set(route.vehicle_id, arr);
  }

  // Por zona, agrupar por frecuencia → vehículos.
  const zoneMap = new Map<string, HierarchyZone>();
  for (const r of routes) {
    if (!zoneMap.has(r.zone_id)) {
      const zone = zoneById.get(r.zone_id);
      zoneMap.set(r.zone_id, {
        zoneId: r.zone_id,
        zoneCode: zone?.code ?? '—',
        zoneName: zone?.name ?? '(zona)',
        frequencyGroups: [],
        totalStops: 0,
        totalKg: 0,
        totalDistanceMeters: 0,
        vehicleCount: 0,
      });
    }
  }

  // Agrupar vehículos por (zoneId, patternLabel).
  const groupsByZone = new Map<string, Map<string, HierarchyFrequencyGroup>>();
  for (const r of routes) {
    const dow = patternByVehicle.get(r.vehicle_id) ?? [];
    const label = patternLabel(dow);
    const zoneGroups = groupsByZone.get(r.zone_id) ?? new Map<string, HierarchyFrequencyGroup>();
    if (!zoneGroups.has(label)) {
      zoneGroups.set(label, {
        label,
        daysOfWeek: [...dow].sort((a, b) => a - b),
        vehicles: [],
        totalStops: 0,
        totalKg: 0,
      });
    }
    groupsByZone.set(r.zone_id, zoneGroups);
  }

  // Construir cada vehículo solo una vez (puede tener varias rutas en el día).
  for (const vehicleId of vehicleIds) {
    const routesForVehicle = routesByVehicle.get(vehicleId) ?? [];
    if (routesForVehicle.length === 0) continue;
    const v = vehicleById.get(vehicleId);
    const firstRoute = routes.find((r) => r.vehicle_id === vehicleId);
    if (!firstRoute) continue;
    const dow = patternByVehicle.get(vehicleId) ?? [];
    const label = patternLabel(dow);
    const driverName = firstRoute.driver_id ? driverNameById.get(firstRoute.driver_id) ?? null : null;
    const totalKg = routesForVehicle.reduce((s, r) => s + r.totalKg, 0);
    const totalStops = routesForVehicle.reduce((s, r) => s + r.totalStops, 0);
    const totalDistance = routesForVehicle.reduce(
      (s, r) => s + (r.totalDistanceMeters ?? 0),
      0,
    );
    const hVehicle: HierarchyVehicle = {
      vehicleId,
      alias: v?.alias ?? null,
      plate: v?.plate ?? '—',
      driverName,
      routes: routesForVehicle,
      totalStops,
      totalKg,
      totalDistanceMeters: totalDistance,
    };
    const zoneGroups = groupsByZone.get(firstRoute.zone_id)!;
    const group = zoneGroups.get(label)!;
    group.vehicles.push(hVehicle);
    group.totalStops += totalStops;
    group.totalKg += totalKg;
  }

  // Materializar las zonas con sus grupos.
  for (const [zoneId, zoneGroups] of groupsByZone) {
    const zone = zoneMap.get(zoneId)!;
    zone.frequencyGroups = [...zoneGroups.values()].sort((a, b) =>
      b.totalKg - a.totalKg,
    );
    for (const g of zone.frequencyGroups) {
      zone.totalStops += g.totalStops;
      zone.totalKg += g.totalKg;
      zone.vehicleCount += g.vehicles.length;
      for (const v of g.vehicles) {
        zone.totalDistanceMeters += v.totalDistanceMeters;
      }
    }
  }

  const zones = [...zoneMap.values()].sort((a, b) => b.totalKg - a.totalKg);

  const totalStops = zones.reduce((s, z) => s + z.totalStops, 0);
  const totalKg = zones.reduce((s, z) => s + z.totalKg, 0);
  const totalDistanceMeters = zones.reduce((s, z) => s + z.totalDistanceMeters, 0);
  const vehicleCount = zones.reduce((s, z) => s + z.vehicleCount, 0);

  return {
    date,
    zones,
    totalStops,
    totalKg,
    totalDistanceMeters,
    routeCount: routes.length,
    vehicleCount,
  };
}
