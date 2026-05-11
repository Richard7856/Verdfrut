// Queries del dashboard cliente — Sprint 14 / ADR-028.
//
// Las agregaciones se hacen en SQL functions (migración 022). Este archivo
// envuelve las RPC calls y devuelve tipos limpios al server component.
//
// Filtros:
//   - from / to: rango de fechas inclusivo (formato YYYY-MM-DD)
//   - zoneId: opcional. Si NULL, RLS decide (admin = todo, zone_manager = su zona).
//
// Las funciones SQL son SECURITY INVOKER → respetan RLS. Un zone_manager nunca
// verá datos de otra zona aunque pase un zoneId distinto al suyo.

import 'server-only';
import { createServerClient } from '@tripdrive/supabase/server';

export interface DashboardFilters {
  from: string;
  to: string;
  zoneId?: string | null;
}

export interface DashboardOverview {
  // Operativos
  routesCompleted: number;
  storesVisited: number;
  stopsTotal: number;
  stopsCompleted: number;
  totalDistanceMeters: number;
  // Comerciales
  numTickets: number;
  totalBilled: number;
  totalReturned: number;
  // Calidad
  totalIncidents: number;
  numClosedStores: number;
  numScaleIssues: number;
  numEscalations: number;
}

export interface DailySeriesPoint {
  day: string;
  deliveries: number;
  billed: number;
}

export interface TopStoreRow {
  storeId: string;
  storeCode: string;
  storeName: string;
  visits: number;
  totalBilled: number;
  incidents: number;
}

export interface TopDriverRow {
  driverId: string;
  driverName: string;
  routesCount: number;
  stopsCompleted: number;
  totalDistanceMeters: number;
  totalBilled: number;
}

const ZERO_OVERVIEW: DashboardOverview = {
  routesCompleted: 0,
  storesVisited: 0,
  stopsTotal: 0,
  stopsCompleted: 0,
  totalDistanceMeters: 0,
  numTickets: 0,
  totalBilled: 0,
  totalReturned: 0,
  totalIncidents: 0,
  numClosedStores: 0,
  numScaleIssues: 0,
  numEscalations: 0,
};

export async function getDashboardOverview(filters: DashboardFilters): Promise<DashboardOverview> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('get_dashboard_overview', {
    from_date: filters.from,
    to_date: filters.to,
    zone_id_filter: filters.zoneId ?? null,
  });

  if (error) throw new Error(`[dashboard.overview] ${error.message}`);
  // La función devuelve TABLE — Supabase lo entrega como array de 1 row
  const row = data?.[0];
  if (!row) return ZERO_OVERVIEW;

  return {
    routesCompleted: Number(row.routes_completed ?? 0),
    storesVisited: Number(row.stores_visited ?? 0),
    stopsTotal: Number(row.stops_total ?? 0),
    stopsCompleted: Number(row.stops_completed ?? 0),
    totalDistanceMeters: Number(row.total_distance_meters ?? 0),
    numTickets: Number(row.num_tickets ?? 0),
    totalBilled: Number(row.total_billed ?? 0),
    totalReturned: Number(row.total_returned ?? 0),
    totalIncidents: Number(row.total_incidents ?? 0),
    numClosedStores: Number(row.num_closed_stores ?? 0),
    numScaleIssues: Number(row.num_scale_issues ?? 0),
    numEscalations: Number(row.num_escalations ?? 0),
  };
}

export async function getDashboardDailySeries(filters: DashboardFilters): Promise<DailySeriesPoint[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('get_dashboard_daily_series', {
    from_date: filters.from,
    to_date: filters.to,
    zone_id_filter: filters.zoneId ?? null,
  });

  if (error) throw new Error(`[dashboard.dailySeries] ${error.message}`);
  return (data ?? []).map((r) => ({
    day: r.day,
    deliveries: Number(r.deliveries ?? 0),
    billed: Number(r.billed ?? 0),
  }));
}

export async function getDashboardTopStores(
  filters: DashboardFilters & { limit?: number },
): Promise<TopStoreRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('get_dashboard_top_stores', {
    from_date: filters.from,
    to_date: filters.to,
    zone_id_filter: filters.zoneId ?? null,
    row_limit: filters.limit ?? 10,
  });

  if (error) throw new Error(`[dashboard.topStores] ${error.message}`);
  return (data ?? []).map((r) => ({
    storeId: r.store_id,
    storeCode: r.store_code,
    storeName: r.store_name,
    visits: Number(r.visits ?? 0),
    totalBilled: Number(r.total_billed ?? 0),
    incidents: Number(r.incidents ?? 0),
  }));
}

export async function getDashboardTopDrivers(
  filters: DashboardFilters & { limit?: number },
): Promise<TopDriverRow[]> {
  const supabase = await createServerClient();
  const { data, error } = await supabase.rpc('get_dashboard_top_drivers', {
    from_date: filters.from,
    to_date: filters.to,
    zone_id_filter: filters.zoneId ?? null,
    row_limit: filters.limit ?? 10,
  });

  if (error) throw new Error(`[dashboard.topDrivers] ${error.message}`);
  return (data ?? []).map((r) => ({
    driverId: r.driver_id,
    driverName: r.driver_name,
    routesCount: Number(r.routes_count ?? 0),
    stopsCompleted: Number(r.stops_completed ?? 0),
    totalDistanceMeters: Number(r.total_distance_meters ?? 0),
    totalBilled: Number(r.total_billed ?? 0),
  }));
}

// ============================================================
// Drill-down — Sprint 15
// ============================================================

export interface StoreVisitRow {
  reportId: string;
  type: 'entrega' | 'tienda_cerrada' | 'bascula';
  status: string;
  createdAt: string;
  routeId: string;
  routeName: string;
  routeDate: string;
  driverId: string | null;
  driverName: string | null;
  ticketNumber: string | null;
  ticketTotal: number | null;
  returnTotal: number | null;
  incidentsCount: number;
  hasMerma: boolean;
  chatStatus: string | null;
}

interface RawStoreVisit {
  id: string;
  type: 'entrega' | 'tienda_cerrada' | 'bascula';
  status: string;
  created_at: string;
  has_merma: boolean;
  chat_status: string | null;
  ticket_data: { numero?: string; total?: number } | null;
  return_ticket_data: { total?: number } | null;
  incident_details: unknown[] | null;
  // Joins
  routes:
    | { id: string; name: string; date: string; driver_id: string | null }
    | { id: string; name: string; date: string; driver_id: string | null }[]
    | null;
}

/**
 * Histórico de visitas a una tienda en el rango. Incluye join con routes para
 * mostrar a qué ruta pertenece cada reporte. Driver name se resuelve aparte
 * (un único query) para evitar JOIN en cascada con user_profiles.
 */
export async function getStoreVisits(opts: {
  storeId: string;
  from: string;
  to: string;
}): Promise<StoreVisitRow[]> {
  const supabase = await createServerClient();

  const toExclusive = nextDayIso(opts.to);
  const { data, error } = await supabase
    .from('delivery_reports')
    .select(
      `
      id, type, status, created_at, has_merma, chat_status,
      ticket_data, return_ticket_data, incident_details,
      routes!inner(id, name, date, driver_id)
    `,
    )
    .eq('store_id', opts.storeId)
    .gte('created_at', opts.from)
    .lt('created_at', toExclusive)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`[dashboard.storeVisits] ${error.message}`);

  const rows = (data ?? []) as unknown as RawStoreVisit[];

  // Resolver nombres de chofer en una segunda pasada para evitar joins anidados que
  // PostgREST tipa de forma confusa.
  const driverIds = Array.from(
    new Set(
      rows
        .map((r) => (Array.isArray(r.routes) ? r.routes[0]?.driver_id : r.routes?.driver_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const driverNameMap = await resolveDriverNames(driverIds);

  return rows.map((r): StoreVisitRow => {
    const route = Array.isArray(r.routes) ? r.routes[0] : r.routes;
    const driverId = route?.driver_id ?? null;
    return {
      reportId: r.id,
      type: r.type,
      status: r.status,
      createdAt: r.created_at,
      routeId: route?.id ?? '',
      routeName: route?.name ?? '',
      routeDate: route?.date ?? '',
      driverId,
      driverName: driverId ? driverNameMap.get(driverId) ?? null : null,
      ticketNumber: r.ticket_data?.numero ?? null,
      ticketTotal: typeof r.ticket_data?.total === 'number' ? r.ticket_data.total : null,
      returnTotal: typeof r.return_ticket_data?.total === 'number' ? r.return_ticket_data.total : null,
      incidentsCount: Array.isArray(r.incident_details) ? r.incident_details.length : 0,
      hasMerma: r.has_merma,
      chatStatus: r.chat_status,
    };
  });
}

export interface DriverRouteRow {
  routeId: string;
  routeName: string;
  date: string;
  status: string;
  totalDistanceMeters: number | null;
  totalDurationSeconds: number | null;
  actualStartAt: string | null;
  actualEndAt: string | null;
  stopsTotal: number;
  stopsCompleted: number;
  totalBilled: number;
}

interface RawDriverRoute {
  id: string;
  name: string;
  date: string;
  status: string;
  total_distance_meters: number | null;
  total_duration_seconds: number | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  stops: { id: string; status: string }[] | null;
  delivery_reports: { ticket_data: { total?: number } | null }[] | null;
}

/**
 * Rutas asignadas a un chofer en el rango. Trae stops y delivery_reports
 * embebidos para computar paradas totales/completadas y facturado por ruta.
 */
export async function getDriverRoutes(opts: {
  driverId: string;
  from: string;
  to: string;
}): Promise<DriverRouteRow[]> {
  const supabase = await createServerClient();

  const { data, error } = await supabase
    .from('routes')
    .select(
      `
      id, name, date, status, total_distance_meters, total_duration_seconds,
      actual_start_at, actual_end_at,
      stops(id, status),
      delivery_reports(ticket_data)
    `,
    )
    .eq('driver_id', opts.driverId)
    .gte('date', opts.from)
    .lte('date', opts.to)
    .order('date', { ascending: false });

  if (error) throw new Error(`[dashboard.driverRoutes] ${error.message}`);

  const rows = (data ?? []) as unknown as RawDriverRoute[];

  return rows.map((r): DriverRouteRow => {
    const stops = r.stops ?? [];
    const reports = r.delivery_reports ?? [];
    const totalBilled = reports.reduce((sum, rep) => {
      const v = rep.ticket_data?.total;
      return sum + (typeof v === 'number' ? v : 0);
    }, 0);
    return {
      routeId: r.id,
      routeName: r.name,
      date: r.date,
      status: r.status,
      totalDistanceMeters: r.total_distance_meters,
      totalDurationSeconds: r.total_duration_seconds,
      actualStartAt: r.actual_start_at,
      actualEndAt: r.actual_end_at,
      stopsTotal: stops.length,
      stopsCompleted: stops.filter((s) => s.status === 'completed').length,
      totalBilled,
    };
  });
}

// --- helpers internos --------------------------------------------------------

async function resolveDriverNames(driverIds: string[]): Promise<Map<string, string>> {
  if (driverIds.length === 0) return new Map();
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from('drivers')
    .select('id, user_id, user_profiles!inner(full_name)')
    .in('id', driverIds);

  if (error) throw new Error(`[dashboard.resolveDriverNames] ${error.message}`);

  const m = new Map<string, string>();
  type Row = { id: string; user_profiles: { full_name: string } | { full_name: string }[] | null };
  for (const r of (data ?? []) as unknown as Row[]) {
    const profile = Array.isArray(r.user_profiles) ? r.user_profiles[0] : r.user_profiles;
    if (profile?.full_name) m.set(r.id, profile.full_name);
  }
  return m;
}

function nextDayIso(yyyymmdd: string): string {
  // YYYY-MM-DD → YYYY-MM-DD del día siguiente (para usar como cota exclusiva)
  const d = new Date(yyyymmdd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// ============================================================
// Export para ERP — Sprint 16
// ============================================================

/**
 * Bundle plano de un delivery_report completo, listo para serializar a XLSX.
 * Incluye todas las relaciones que el ERP necesita para reconciliar la entrega:
 * fecha, ruta, tienda, chofer, ticket original y devolución, incidentes.
 */
export interface ExportReport {
  reportId: string;
  type: 'entrega' | 'tienda_cerrada' | 'bascula';
  status: string;
  createdAt: string;
  resolvedAt: string | null;
  hasMerma: boolean;
  // Tienda
  storeId: string;
  storeCode: string;
  storeName: string;
  // Ruta
  routeId: string;
  routeName: string;
  routeDate: string;
  // Chofer (puede ser null si la ruta quedó sin asignar)
  driverId: string | null;
  driverName: string | null;
  // Ticket principal
  ticketNumber: string | null;
  ticketDate: string | null;
  ticketTotal: number | null;
  ticketItems: ExportTicketItem[];
  // Devolución / merma
  returnTicketNumber: string | null;
  returnTicketTotal: number | null;
  returnTicketItems: ExportTicketItem[];
  // Incidentes declarados manualmente por el chofer
  incidents: ExportIncident[];
}

export interface ExportTicketItem {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  total: number | null;
}

export interface ExportIncident {
  productName: string;
  type: 'rechazo' | 'faltante' | 'sobrante' | 'devolucion';
  quantity: number;
  unit: string;
  notes: string | null;
}

interface RawExportRow {
  id: string;
  type: 'entrega' | 'tienda_cerrada' | 'bascula';
  status: string;
  created_at: string;
  resolved_at: string | null;
  has_merma: boolean;
  store_id: string;
  store_code: string;
  store_name: string;
  ticket_data: {
    numero?: string;
    fecha?: string;
    total?: number;
    items?: Array<{
      description?: string;
      quantity?: number;
      unit?: string;
      unitPrice?: number;
      total?: number;
    }>;
  } | null;
  return_ticket_data: {
    numero?: string;
    total?: number;
    items?: Array<{
      description?: string;
      quantity?: number;
      unit?: string;
      unitPrice?: number;
      total?: number;
    }>;
  } | null;
  incident_details: Array<{
    productName?: string;
    type?: 'rechazo' | 'faltante' | 'sobrante' | 'devolucion';
    quantity?: number;
    unit?: string;
    notes?: string;
  }> | null;
  routes:
    | { id: string; name: string; date: string; driver_id: string | null }
    | { id: string; name: string; date: string; driver_id: string | null }[]
    | null;
}

/**
 * Carga todos los reportes del rango con sus joins planos.
 * Filtra a delivery_reports.created_at en el rango — no por route.date —
 * porque el ERP reconcilia por la fecha en que el chofer cerró el reporte.
 */
export async function getExportReports(filters: DashboardFilters): Promise<ExportReport[]> {
  const supabase = await createServerClient();
  const toExclusive = nextDayIso(filters.to);

  let q = supabase
    .from('delivery_reports')
    .select(
      `
      id, type, status, created_at, resolved_at, has_merma,
      store_id, store_code, store_name,
      ticket_data, return_ticket_data, incident_details,
      routes!inner(id, name, date, driver_id)
    `,
    )
    .gte('created_at', filters.from)
    .lt('created_at', toExclusive)
    .order('created_at', { ascending: true });

  if (filters.zoneId) q = q.eq('zone_id', filters.zoneId);

  const { data, error } = await q;
  if (error) throw new Error(`[dashboard.exportReports] ${error.message}`);

  const rows = (data ?? []) as unknown as RawExportRow[];

  // Resolver nombres de chofer en una sola pasada
  const driverIds = Array.from(
    new Set(
      rows
        .map((r) => (Array.isArray(r.routes) ? r.routes[0]?.driver_id : r.routes?.driver_id))
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const driverNameMap = await resolveDriverNames(driverIds);

  return rows.map((r): ExportReport => {
    const route = Array.isArray(r.routes) ? r.routes[0] : r.routes;
    const driverId = route?.driver_id ?? null;
    return {
      reportId: r.id,
      type: r.type,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      hasMerma: r.has_merma,
      storeId: r.store_id,
      storeCode: r.store_code,
      storeName: r.store_name,
      routeId: route?.id ?? '',
      routeName: route?.name ?? '',
      routeDate: route?.date ?? '',
      driverId,
      driverName: driverId ? driverNameMap.get(driverId) ?? null : null,
      ticketNumber: r.ticket_data?.numero ?? null,
      ticketDate: r.ticket_data?.fecha ?? null,
      ticketTotal: typeof r.ticket_data?.total === 'number' ? r.ticket_data.total : null,
      ticketItems: normalizeItems(r.ticket_data?.items),
      returnTicketNumber: r.return_ticket_data?.numero ?? null,
      returnTicketTotal:
        typeof r.return_ticket_data?.total === 'number' ? r.return_ticket_data.total : null,
      returnTicketItems: normalizeItems(r.return_ticket_data?.items),
      incidents: normalizeIncidents(r.incident_details),
    };
  });
}

interface RawTicketItem {
  description?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  total?: number;
}

function normalizeItems(items: RawTicketItem[] | undefined): ExportTicketItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((it) => ({
    description: typeof it.description === 'string' ? it.description : '',
    quantity: typeof it.quantity === 'number' ? it.quantity : null,
    unit: typeof it.unit === 'string' ? it.unit : null,
    unitPrice: typeof it.unitPrice === 'number' ? it.unitPrice : null,
    total: typeof it.total === 'number' ? it.total : null,
  }));
}

function normalizeIncidents(
  arr: RawExportRow['incident_details'],
): ExportIncident[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((d) => ({
    productName: typeof d.productName === 'string' ? d.productName : '',
    type: (d.type ?? 'rechazo') as ExportIncident['type'],
    quantity: typeof d.quantity === 'number' ? d.quantity : 0,
    unit: typeof d.unit === 'string' ? d.unit : '',
    notes: typeof d.notes === 'string' ? d.notes : null,
  }));
}
