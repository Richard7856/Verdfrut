// Queries de customers — Fase A2 del Stream A (ADR-086).
//
// Los customers viven en el tenant project compartido (schema `public`),
// no en el control_plane schema. El Control Plane usa service_role (mismo
// proyecto Supabase) para verlos cross-customer bypaseando la RLS
// `customers_select` que restringe a "tu propio customer".

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import type { TableUpdate } from '@tripdrive/supabase';
import { sanitizeFeatureOverrides, type PlanFeatures } from '@tripdrive/plans';

export type CustomerStatus = 'active' | 'paused' | 'churned' | 'demo';
export type CustomerTier = 'starter' | 'pro' | 'enterprise';

export interface Customer {
  id: string;
  slug: string;
  name: string;
  legalName: string | null;
  rfc: string | null;
  status: CustomerStatus;
  tier: CustomerTier;
  timezone: string;
  brandColorPrimary: string | null;
  brandLogoUrl: string | null;
  monthlyFeeMxn: number | null;
  perDriverFeeMxn: number | null;
  contractStartedAt: string | null;
  contractEndsAt: string | null;
  notes: string | null;
  /** ADR-095. Sanitizado: sólo keys que matchean PlanFeatures. */
  featureOverrides: Partial<PlanFeatures>;
  createdAt: string;
  updatedAt: string;
}

interface CustomerRow {
  id: string;
  slug: string;
  name: string;
  legal_name: string | null;
  rfc: string | null;
  status: CustomerStatus;
  tier: CustomerTier;
  timezone: string;
  brand_color_primary: string | null;
  brand_logo_url: string | null;
  monthly_fee_mxn: number | null;
  per_driver_fee_mxn: number | null;
  contract_started_at: string | null;
  contract_ends_at: string | null;
  notes: string | null;
  feature_overrides: unknown;
  created_at: string;
  updated_at: string;
}

const CUSTOMER_COLS = `
  id, slug, name, legal_name, rfc, status, tier, timezone,
  brand_color_primary, brand_logo_url,
  monthly_fee_mxn, per_driver_fee_mxn,
  contract_started_at, contract_ends_at,
  notes, feature_overrides, created_at, updated_at
`;

function toCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    legalName: row.legal_name,
    rfc: row.rfc,
    status: row.status,
    tier: row.tier,
    timezone: row.timezone,
    brandColorPrimary: row.brand_color_primary,
    brandLogoUrl: row.brand_logo_url,
    monthlyFeeMxn: row.monthly_fee_mxn,
    perDriverFeeMxn: row.per_driver_fee_mxn,
    contractStartedAt: row.contract_started_at,
    contractEndsAt: row.contract_ends_at,
    notes: row.notes,
    featureOverrides: sanitizeFeatureOverrides(row.feature_overrides),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomers(opts?: { status?: CustomerStatus }): Promise<Customer[]> {
  let q = createServiceRoleClient().from('customers').select(CUSTOMER_COLS).order('name');
  if (opts?.status) q = q.eq('status', opts.status);

  const { data, error } = await q;
  if (error) throw new Error(`[cp.customers.list] ${error.message}`);
  return (data ?? []).map((row) => toCustomer(row as unknown as CustomerRow));
}

export async function getCustomerBySlug(slug: string): Promise<Customer | null> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw new Error(`[cp.customers.getBySlug] ${error.message}`);
  return data ? toCustomer(data as unknown as CustomerRow) : null;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select(CUSTOMER_COLS)
    .eq('id', id)
    .maybeSingle();

  if (error) throw new Error(`[cp.customers.getById] ${error.message}`);
  return data ? toCustomer(data as unknown as CustomerRow) : null;
}

// KPIs operativos del customer: cuenta de entidades en su tenant compartido.
// Tabla operativa filtrada por customer_id (post-mig 037). Reads en paralelo.
export interface CustomerOpsCounts {
  zones: number;
  depots: number;
  stores: number;
  vehicles: number;
  drivers: number;
  users: number;
  activeRoutes: number;
  dispatchesLast30d: number;
}

export async function getCustomerOpsCounts(customerId: string): Promise<CustomerOpsCounts> {
  const sb = createServiceRoleClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const counts = await Promise.all([
    sb.from('zones').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('depots').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('stores').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('vehicles').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('drivers').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('user_profiles').select('id', { count: 'exact', head: true }).eq('customer_id', customerId),
    sb.from('routes').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .in('status', ['PUBLISHED', 'IN_PROGRESS']),
    sb.from('dispatches').select('id', { count: 'exact', head: true })
      .eq('customer_id', customerId)
      .gte('created_at', since),
  ]);

  return {
    zones: counts[0].count ?? 0,
    depots: counts[1].count ?? 0,
    stores: counts[2].count ?? 0,
    vehicles: counts[3].count ?? 0,
    drivers: counts[4].count ?? 0,
    users: counts[5].count ?? 0,
    activeRoutes: counts[6].count ?? 0,
    dispatchesLast30d: counts[7].count ?? 0,
  };
}

// ============================================================================
// Ola 1 / A3-ops — Vista operativa del customer.
//
// El super-admin TripDrive (CP) ve qué hacen los choferes de cada customer
// hoy desde `/customers/[slug]`: rutas activas, choferes en ruta, paradas
// completadas/pendientes, tiros pendientes de publicar.
// ============================================================================

import { todayInZone } from '@tripdrive/utils';

export interface CustomerOpsToday {
  date: string;
  activeRoutesToday: number;
  driversInRouteToday: number;
  stopsCompletedToday: number;
  stopsPendingToday: number;
  openIncidentsToday: number;
  pendingDispatches: number;
}

export async function getCustomerOpsToday(
  customerId: string,
  timezone: string,
): Promise<CustomerOpsToday> {
  const sb = createServiceRoleClient();
  const today = todayInZone(timezone);

  // routes activas hoy del customer
  const { data: routesToday } = await sb
    .from('routes')
    .select('id, driver_id, status')
    .eq('customer_id', customerId)
    .eq('date', today)
    .in('status', ['PUBLISHED', 'IN_PROGRESS']);

  const routeIds = (routesToday ?? []).map((r) => r.id as string);
  const driverIds = new Set(
    (routesToday ?? [])
      .map((r) => r.driver_id as string | null)
      .filter((v): v is string => v !== null),
  );

  // stops counts: pending + completed dentro de las rutas activas hoy
  let stopsCompletedToday = 0;
  let stopsPendingToday = 0;
  if (routeIds.length > 0) {
    const [completed, pending] = await Promise.all([
      sb.from('stops').select('id', { count: 'exact', head: true })
        .in('route_id', routeIds)
        .in('status', ['completed', 'skipped']),
      sb.from('stops').select('id', { count: 'exact', head: true })
        .in('route_id', routeIds)
        .eq('status', 'pending'),
    ]);
    stopsCompletedToday = completed.count ?? 0;
    stopsPendingToday = pending.count ?? 0;
  }

  // incidencias abiertas hoy (delivery_reports con chat_status='open' de rutas activas)
  let openIncidentsToday = 0;
  if (routeIds.length > 0) {
    const { count } = await sb
      .from('delivery_reports')
      .select('id', { count: 'exact', head: true })
      .in('route_id', routeIds)
      .eq('chat_status', 'open');
    openIncidentsToday = count ?? 0;
  }

  // tiros pendientes de publicar (status='planning') a partir de hoy
  const { count: pendingDispatchesCount } = await sb
    .from('dispatches')
    .select('id', { count: 'exact', head: true })
    .eq('customer_id', customerId)
    .eq('status', 'planning')
    .gte('date', today);

  return {
    date: today,
    activeRoutesToday: routesToday?.length ?? 0,
    driversInRouteToday: driverIds.size,
    stopsCompletedToday,
    stopsPendingToday,
    openIncidentsToday,
    pendingDispatches: pendingDispatchesCount ?? 0,
  };
}

export interface ActiveRouteRow {
  id: string;
  name: string;
  status: 'PUBLISHED' | 'IN_PROGRESS';
  date: string;
  driverName: string | null;
  vehiclePlate: string | null;
  totalStops: number;
  completedStops: number;
  arrivedStops: number;
  pendingStops: number;
  openIncidents: number;
}

export async function listActiveRoutesForCustomer(
  customerId: string,
  timezone: string,
): Promise<ActiveRouteRow[]> {
  const sb = createServiceRoleClient();
  const today = todayInZone(timezone);

  const { data: routes, error } = await sb
    .from('routes')
    .select(`
      id, name, status, date, driver_id, vehicle_id,
      drivers:driver_id ( id, user_id, user_profiles:user_id ( full_name ) ),
      vehicles:vehicle_id ( id, plate )
    `)
    .eq('customer_id', customerId)
    .eq('date', today)
    .in('status', ['PUBLISHED', 'IN_PROGRESS'])
    .order('name');

  if (error) throw new Error(`[cp.customers.activeRoutes] ${error.message}`);
  const list = (routes ?? []) as unknown as Array<{
    id: string;
    name: string;
    status: 'PUBLISHED' | 'IN_PROGRESS';
    date: string;
    drivers: { user_profiles: { full_name: string } | null } | null;
    vehicles: { plate: string } | null;
  }>;

  if (list.length === 0) return [];

  // Cargar todas las stops de estas rutas en una sola query y agregamos por route_id.
  const routeIds = list.map((r) => r.id);
  const { data: stops } = await sb
    .from('stops')
    .select('route_id, status')
    .in('route_id', routeIds);

  const stopsByRoute = new Map<string, { total: number; done: number; arrived: number; pending: number }>();
  for (const s of stops ?? []) {
    const rid = s.route_id as string;
    const slot = stopsByRoute.get(rid) ?? { total: 0, done: 0, arrived: 0, pending: 0 };
    slot.total++;
    if (s.status === 'completed' || s.status === 'skipped') slot.done++;
    else if (s.status === 'arrived') slot.arrived++;
    else if (s.status === 'pending') slot.pending++;
    stopsByRoute.set(rid, slot);
  }

  // Incidencias abiertas por ruta.
  const { data: incidents } = await sb
    .from('delivery_reports')
    .select('route_id')
    .in('route_id', routeIds)
    .eq('chat_status', 'open');
  const incidentsByRoute = new Map<string, number>();
  for (const inc of incidents ?? []) {
    const rid = inc.route_id as string;
    incidentsByRoute.set(rid, (incidentsByRoute.get(rid) ?? 0) + 1);
  }

  return list.map((r) => {
    const stopStats = stopsByRoute.get(r.id) ?? { total: 0, done: 0, arrived: 0, pending: 0 };
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      date: r.date,
      driverName: r.drivers?.user_profiles?.full_name ?? null,
      vehiclePlate: r.vehicles?.plate ?? null,
      totalStops: stopStats.total,
      completedStops: stopStats.done,
      arrivedStops: stopStats.arrived,
      pendingStops: stopStats.pending,
      openIncidents: incidentsByRoute.get(r.id) ?? 0,
    };
  });
}

export interface PendingDispatchRow {
  id: string;
  name: string;
  date: string;
  status: 'planning' | 'dispatched' | 'completed' | 'cancelled';
  notes: string | null;
  routeCount: number;
  storeCount: number;
}

export async function listPendingDispatchesForCustomer(
  customerId: string,
  timezone: string,
): Promise<PendingDispatchRow[]> {
  const sb = createServiceRoleClient();
  const today = todayInZone(timezone);

  const { data: dispatches, error } = await sb
    .from('dispatches')
    .select('id, name, date, status, notes')
    .eq('customer_id', customerId)
    .eq('status', 'planning')
    .gte('date', today)
    .order('date', { ascending: true })
    .limit(20);

  if (error) throw new Error(`[cp.customers.pendingDispatches] ${error.message}`);
  const list = (dispatches ?? []) as Array<{
    id: string;
    name: string;
    date: string;
    status: 'planning';
    notes: string | null;
  }>;

  if (list.length === 0) return [];

  const dispatchIds = list.map((d) => d.id);
  const { data: routes } = await sb
    .from('routes')
    .select('id, dispatch_id')
    .in('dispatch_id', dispatchIds);
  const routesByDispatch = new Map<string, string[]>();
  for (const r of routes ?? []) {
    const did = r.dispatch_id as string;
    const arr = routesByDispatch.get(did) ?? [];
    arr.push(r.id as string);
    routesByDispatch.set(did, arr);
  }

  const allRouteIds = (routes ?? []).map((r) => r.id as string);
  let stopsByRoute = new Map<string, number>();
  if (allRouteIds.length > 0) {
    const { data: stops } = await sb
      .from('stops')
      .select('route_id')
      .in('route_id', allRouteIds);
    for (const s of stops ?? []) {
      const rid = s.route_id as string;
      stopsByRoute.set(rid, (stopsByRoute.get(rid) ?? 0) + 1);
    }
  }

  return list.map((d) => {
    const dRouteIds = routesByDispatch.get(d.id) ?? [];
    const storeCount = dRouteIds.reduce(
      (sum, rid) => sum + (stopsByRoute.get(rid) ?? 0),
      0,
    );
    return {
      id: d.id,
      name: d.name,
      date: d.date,
      status: d.status,
      notes: d.notes,
      routeCount: dRouteIds.length,
      storeCount,
    };
  });
}

// ============================================================================
// A3-ops.3 — Detail de ruta para CP (super-admin TripDrive ve TODO el flujo).
// ============================================================================

export interface RouteStopRow {
  id: string;
  sequence: number;
  status: 'pending' | 'arrived' | 'completed' | 'skipped';
  storeCode: string;
  storeName: string;
  storeAddress: string;
  storeLat: number;
  storeLng: number;
  plannedArrivalAt: string | null;
  plannedDepartureAt: string | null;
  actualArrivalAt: string | null;
  actualDepartureAt: string | null;
  notes: string | null;
  arrivalWasMocked: boolean | null;
  arrivalDistanceMeters: number | null;
  arrivalAccuracyMeters: number | null;
}

export interface RouteBreadcrumbRow {
  recordedAt: string;
  lat: number;
  lng: number;
  speed: number | null;
}

export interface RouteDetail {
  id: string;
  name: string;
  date: string;
  status: string;
  customerId: string;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string;
  vehiclePlate: string | null;
  zoneId: string;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  estimatedStartAt: string | null;
  estimatedEndAt: string | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  publishedAt: string | null;
  stops: RouteStopRow[];
  lastBreadcrumb: RouteBreadcrumbRow | null;
  recentBreadcrumbs: RouteBreadcrumbRow[];
}

export async function getRouteDetailForCustomer(
  customerId: string,
  routeId: string,
): Promise<RouteDetail | null> {
  const sb = createServiceRoleClient();

  const { data: route, error: rtErr } = await sb
    .from('routes')
    .select(`
      id, name, date, status, customer_id, driver_id, vehicle_id, zone_id,
      total_distance_meters, total_duration_seconds,
      estimated_start_at, estimated_end_at,
      actual_start_at, actual_end_at, published_at,
      drivers:driver_id ( id, user_id, user_profiles:user_id ( full_name ) ),
      vehicles:vehicle_id ( id, plate )
    `)
    .eq('id', routeId)
    .eq('customer_id', customerId)
    .maybeSingle();

  if (rtErr) throw new Error(`[cp.customers.routeDetail] ${rtErr.message}`);
  if (!route) return null;

  const r = route as unknown as {
    id: string;
    name: string;
    date: string;
    status: string;
    customer_id: string;
    driver_id: string | null;
    vehicle_id: string;
    zone_id: string;
    total_distance_meters: number | null;
    total_duration_seconds: number | null;
    estimated_start_at: string | null;
    estimated_end_at: string | null;
    actual_start_at: string | null;
    actual_end_at: string | null;
    published_at: string | null;
    drivers: { user_profiles: { full_name: string } | null } | null;
    vehicles: { plate: string } | null;
  };

  // Stops + stores join
  const { data: stops } = await sb
    .from('stops')
    .select(`
      id, sequence, status, planned_arrival_at, planned_departure_at,
      actual_arrival_at, actual_departure_at, notes,
      arrival_was_mocked, arrival_distance_meters, arrival_accuracy_meters,
      stores:store_id ( code, name, address, lat, lng )
    `)
    .eq('route_id', routeId)
    .order('sequence', { ascending: true });

  const stopRows: RouteStopRow[] = ((stops ?? []) as unknown as Array<{
    id: string;
    sequence: number;
    status: RouteStopRow['status'];
    planned_arrival_at: string | null;
    planned_departure_at: string | null;
    actual_arrival_at: string | null;
    actual_departure_at: string | null;
    notes: string | null;
    arrival_was_mocked: boolean | null;
    arrival_distance_meters: number | null;
    arrival_accuracy_meters: number | null;
    stores: { code: string; name: string; address: string; lat: number; lng: number } | null;
  }>).map((s) => ({
    id: s.id,
    sequence: s.sequence,
    status: s.status,
    storeCode: s.stores?.code ?? '—',
    storeName: s.stores?.name ?? '—',
    storeAddress: s.stores?.address ?? '',
    storeLat: s.stores?.lat ?? 0,
    storeLng: s.stores?.lng ?? 0,
    plannedArrivalAt: s.planned_arrival_at,
    plannedDepartureAt: s.planned_departure_at,
    actualArrivalAt: s.actual_arrival_at,
    actualDepartureAt: s.actual_departure_at,
    notes: s.notes,
    arrivalWasMocked: s.arrival_was_mocked,
    arrivalDistanceMeters: s.arrival_distance_meters,
    arrivalAccuracyMeters: s.arrival_accuracy_meters,
  }));

  // Últimos 50 breadcrumbs para el indicador de actividad reciente.
  const { data: breadcrumbs } = await sb
    .from('route_breadcrumbs')
    .select('recorded_at, lat, lng, speed')
    .eq('route_id', routeId)
    .order('recorded_at', { ascending: false })
    .limit(50);

  const recent: RouteBreadcrumbRow[] = ((breadcrumbs ?? []) as Array<{
    recorded_at: string; lat: number; lng: number; speed: number | null;
  }>).map((b) => ({
    recordedAt: b.recorded_at,
    lat: b.lat,
    lng: b.lng,
    speed: b.speed,
  }));

  return {
    id: r.id,
    name: r.name,
    date: r.date,
    status: r.status,
    customerId: r.customer_id,
    driverId: r.driver_id,
    driverName: r.drivers?.user_profiles?.full_name ?? null,
    vehicleId: r.vehicle_id,
    vehiclePlate: r.vehicles?.plate ?? null,
    zoneId: r.zone_id,
    totalDistanceMeters: r.total_distance_meters,
    totalDurationSeconds: r.total_duration_seconds,
    estimatedStartAt: r.estimated_start_at,
    estimatedEndAt: r.estimated_end_at,
    actualStartAt: r.actual_start_at,
    actualEndAt: r.actual_end_at,
    publishedAt: r.published_at,
    stops: stopRows,
    lastBreadcrumb: recent[0] ?? null,
    recentBreadcrumbs: recent,
  };
}

// Mutaciones — todas via service_role (CP es super-admin cross-customer).
// Validaciones de input duras: el slug es el subdomain, no permite cambios
// libres una vez creado (issue #232 si queremos rename con redirect).

export interface CreateCustomerInput {
  slug: string;
  name: string;
  legalName?: string | null;
  rfc?: string | null;
  status?: CustomerStatus;
  tier?: CustomerTier;
  timezone?: string;
  brandColorPrimary?: string | null;
  brandLogoUrl?: string | null;
  monthlyFeeMxn?: number | null;
  perDriverFeeMxn?: number | null;
  contractStartedAt?: string | null;
  contractEndsAt?: string | null;
  notes?: string | null;
  featureOverrides?: Partial<PlanFeatures>;
}

// slug: lowercase, alfanumérico + guiones, 2-40 chars. Es el subdomain.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export async function createCustomer(input: CreateCustomerInput): Promise<Customer> {
  const slug = input.slug.trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    throw new Error('slug inválido (2-40 chars, lowercase a-z, 0-9, guiones; no inicia/termina con guión)');
  }
  if (!input.name.trim()) {
    throw new Error('name requerido');
  }

  const sb = createServiceRoleClient();
  const { data, error } = await sb
    .from('customers')
    .insert({
      slug,
      name: input.name.trim(),
      legal_name: input.legalName ?? null,
      rfc: input.rfc ?? null,
      status: input.status ?? 'demo',
      tier: input.tier ?? 'starter',
      timezone: input.timezone ?? 'America/Mexico_City',
      brand_color_primary: input.brandColorPrimary ?? '#34c97c',
      brand_logo_url: input.brandLogoUrl ?? null,
      monthly_fee_mxn: input.monthlyFeeMxn ?? null,
      per_driver_fee_mxn: input.perDriverFeeMxn ?? null,
      contract_started_at: input.contractStartedAt ?? null,
      contract_ends_at: input.contractEndsAt ?? null,
      notes: input.notes ?? null,
      feature_overrides: input.featureOverrides ?? {},
    })
    .select(CUSTOMER_COLS)
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error(`Ya existe un customer con slug '${slug}'`);
    }
    throw new Error(`[cp.customers.create] ${error.message}`);
  }
  return toCustomer(data as unknown as CustomerRow);
}

// Update — el slug NO se cambia desde aquí. Cambios libres: status, tier,
// branding, comercial, notas. Cambios de timezone afectan ventanas; OK.
export interface UpdateCustomerInput {
  name?: string;
  legalName?: string | null;
  rfc?: string | null;
  status?: CustomerStatus;
  tier?: CustomerTier;
  timezone?: string;
  brandColorPrimary?: string | null;
  brandLogoUrl?: string | null;
  monthlyFeeMxn?: number | null;
  perDriverFeeMxn?: number | null;
  contractStartedAt?: string | null;
  contractEndsAt?: string | null;
  notes?: string | null;
  featureOverrides?: Partial<PlanFeatures>;
}

export async function updateCustomer(id: string, input: UpdateCustomerInput): Promise<Customer> {
  const update: TableUpdate<'customers'> = {
    updated_at: new Date().toISOString(),
  };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('name no puede ser vacío');
    update.name = input.name.trim();
  }
  if (input.legalName !== undefined) update.legal_name = input.legalName;
  if (input.rfc !== undefined) update.rfc = input.rfc;
  if (input.status !== undefined) update.status = input.status;
  if (input.tier !== undefined) update.tier = input.tier;
  if (input.timezone !== undefined) update.timezone = input.timezone;
  if (input.brandColorPrimary !== undefined) update.brand_color_primary = input.brandColorPrimary;
  if (input.brandLogoUrl !== undefined) update.brand_logo_url = input.brandLogoUrl;
  if (input.monthlyFeeMxn !== undefined) update.monthly_fee_mxn = input.monthlyFeeMxn;
  if (input.perDriverFeeMxn !== undefined) update.per_driver_fee_mxn = input.perDriverFeeMxn;
  if (input.contractStartedAt !== undefined) update.contract_started_at = input.contractStartedAt;
  if (input.contractEndsAt !== undefined) update.contract_ends_at = input.contractEndsAt;
  if (input.notes !== undefined) update.notes = input.notes;
  if (input.featureOverrides !== undefined) update.feature_overrides = input.featureOverrides;

  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .update(update)
    .eq('id', id)
    .select(CUSTOMER_COLS)
    .single();

  if (error) throw new Error(`[cp.customers.update] ${error.message}`);
  return toCustomer(data as unknown as CustomerRow);
}

// Agregación global de customers para el overview.
export interface CustomersAggregate {
  total: number;
  byStatus: Record<CustomerStatus, number>;
  byTier: Record<CustomerTier, number>;
  totalMonthlyFee: number;
}

export async function getCustomersAggregate(): Promise<CustomersAggregate> {
  const { data, error } = await createServiceRoleClient()
    .from('customers')
    .select('status, tier, monthly_fee_mxn');
  if (error) throw new Error(`[cp.customers.aggregate] ${error.message}`);

  const byStatus: Record<CustomerStatus, number> = {
    active: 0, paused: 0, churned: 0, demo: 0,
  };
  const byTier: Record<CustomerTier, number> = {
    starter: 0, pro: 0, enterprise: 0,
  };
  let totalMonthlyFee = 0;

  for (const r of (data ?? []) as Array<{
    status: CustomerStatus;
    tier: CustomerTier;
    monthly_fee_mxn: number | null;
  }>) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
    if (r.status === 'active' && r.monthly_fee_mxn !== null) {
      totalMonthlyFee += Number(r.monthly_fee_mxn);
    }
  }

  return {
    total: (data ?? []).length,
    byStatus,
    byTier,
    totalMonthlyFee,
  };
}
