// Tools de lectura — sin side effects en BD.
// is_write=false → no consumen quota mensual del customer.
// requires_confirmation=false → ejecutan inmediato.
//
// Scope: tiros del día actual y los próximos 7 días (sec. "Trabaja con
// fechas cortas" del system prompt). Más history queda fuera para reducir
// risk de alucinación + costo de tokens.

import type { ToolDefinition, ToolResult } from '../types';
import { todayInZone } from '@tripdrive/utils';

// ============================================================================
// list_dispatches_today
// ============================================================================
interface ListDispatchesArgs {
  date_filter?: 'today' | 'next_7_days';
  status?: 'planning' | 'dispatched' | 'completed' | 'cancelled';
}

interface DispatchSummary {
  id: string;
  name: string;
  date: string;
  status: string;
  zone_id: string;
  zone_name: string | null;
  notes: string | null;
  route_count: number;
  stop_count: number;
}

const list_dispatches_today: ToolDefinition<ListDispatchesArgs, DispatchSummary[]> = {
  name: 'list_dispatches_today',
  description:
    'Lista los tiros (dispatches) del día actual o de los próximos 7 días. Incluye nombre, fecha, zona, estado, número de rutas y paradas. Úsala primero cuando el usuario menciona "el tiro de hoy", "tiros pendientes", o cuando necesitas resolver un nombre de tiro a su ID.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      date_filter: {
        type: 'string',
        enum: ['today', 'next_7_days'],
        description: 'Default "today". Usa "next_7_days" si el usuario habla de tiros futuros.',
      },
      status: {
        type: 'string',
        enum: ['planning', 'dispatched', 'completed', 'cancelled'],
        description: 'Opcional. Filtra por estado del tiro. Omite para ver todos.',
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult<DispatchSummary[]>> => {
    try {
      const today = todayInZone(ctx.timezone);
      const dateFilter = args.date_filter ?? 'today';
      const startDate = today;
      const endDate =
        dateFilter === 'today'
          ? today
          : new Date(new Date(today + 'T00:00:00Z').getTime() + 7 * 24 * 60 * 60 * 1000)
              .toISOString()
              .slice(0, 10);

      let q = ctx.supabase
        .from('dispatches')
        .select('id, name, date, status, zone_id, notes, zones:zone_id ( name )')
        .eq('customer_id', ctx.customerId)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (args.status) {
        q = q.eq('status', args.status);
      }

      const { data, error } = await q;
      if (error) return { ok: false, error: `Error de BD: ${error.message}` };

      const dispatches = (data ?? []) as unknown as Array<{
        id: string;
        name: string;
        date: string;
        status: string;
        zone_id: string;
        notes: string | null;
        zones: { name: string } | null;
      }>;

      if (dispatches.length === 0) {
        return {
          ok: true,
          data: [],
          summary: `Sin tiros para el filtro ${dateFilter}${args.status ? ` y estado ${args.status}` : ''}.`,
        };
      }

      const dispatchIds = dispatches.map((d) => d.id);
      const { data: routes } = await ctx.supabase
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
      const stopsByRoute = new Map<string, number>();
      if (allRouteIds.length > 0) {
        const { data: stops } = await ctx.supabase
          .from('stops')
          .select('route_id')
          .in('route_id', allRouteIds);
        for (const s of stops ?? []) {
          const rid = s.route_id as string;
          stopsByRoute.set(rid, (stopsByRoute.get(rid) ?? 0) + 1);
        }
      }

      const result: DispatchSummary[] = dispatches.map((d) => {
        const dRoutes = routesByDispatch.get(d.id) ?? [];
        const stopCount = dRoutes.reduce((sum, rid) => sum + (stopsByRoute.get(rid) ?? 0), 0);
        return {
          id: d.id,
          name: d.name,
          date: d.date,
          status: d.status,
          zone_id: d.zone_id,
          zone_name: d.zones?.name ?? null,
          notes: d.notes,
          route_count: dRoutes.length,
          stop_count: stopCount,
        };
      });

      return {
        ok: true,
        data: result,
        summary: `${result.length} tiro(s) encontrado(s).`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Excepción inesperada',
      };
    }
  },
};

// ============================================================================
// list_routes
// ============================================================================
interface ListRoutesArgs {
  dispatch_id: string;
}

interface RouteSummary {
  id: string;
  name: string;
  status: string;
  date: string;
  vehicle_id: string;
  vehicle_plate: string | null;
  driver_id: string | null;
  driver_name: string | null;
  total_stops: number;
  completed_stops: number;
  pending_stops: number;
}

const list_routes: ToolDefinition<ListRoutesArgs, RouteSummary[]> = {
  name: 'list_routes',
  description:
    'Lista las rutas de un tiro específico, con sus paradas, chofer asignado, vehículo y progreso. Úsala después de list_dispatches_today para profundizar en un tiro concreto.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: {
        type: 'string',
        description: 'UUID del tiro. Obtenlo primero de list_dispatches_today.',
        format: 'uuid',
      },
    },
    required: ['dispatch_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<RouteSummary[]>> => {
    try {
      const { data, error } = await ctx.supabase
        .from('routes')
        .select(`
          id, name, status, date, vehicle_id, driver_id,
          vehicles:vehicle_id ( plate ),
          drivers:driver_id ( user_id, user_profiles:user_id ( full_name ) )
        `)
        .eq('customer_id', ctx.customerId)
        .eq('dispatch_id', args.dispatch_id)
        .order('name');

      if (error) return { ok: false, error: `Error de BD: ${error.message}` };

      const routes = (data ?? []) as unknown as Array<{
        id: string;
        name: string;
        status: string;
        date: string;
        vehicle_id: string;
        driver_id: string | null;
        vehicles: { plate: string } | null;
        drivers: { user_profiles: { full_name: string } | null } | null;
      }>;

      if (routes.length === 0) {
        return {
          ok: true,
          data: [],
          summary: 'Este tiro no tiene rutas todavía.',
        };
      }

      const routeIds = routes.map((r) => r.id);
      const { data: stops } = await ctx.supabase
        .from('stops')
        .select('route_id, status')
        .in('route_id', routeIds);

      const statsByRoute = new Map<string, { total: number; done: number; pending: number }>();
      for (const s of stops ?? []) {
        const rid = s.route_id as string;
        const slot = statsByRoute.get(rid) ?? { total: 0, done: 0, pending: 0 };
        slot.total++;
        if (s.status === 'completed' || s.status === 'skipped') slot.done++;
        else if (s.status === 'pending') slot.pending++;
        statsByRoute.set(rid, slot);
      }

      const result: RouteSummary[] = routes.map((r) => {
        const s = statsByRoute.get(r.id) ?? { total: 0, done: 0, pending: 0 };
        return {
          id: r.id,
          name: r.name,
          status: r.status,
          date: r.date,
          vehicle_id: r.vehicle_id,
          vehicle_plate: r.vehicles?.plate ?? null,
          driver_id: r.driver_id,
          driver_name: r.drivers?.user_profiles?.full_name ?? null,
          total_stops: s.total,
          completed_stops: s.done,
          pending_stops: s.pending,
        };
      });

      return { ok: true, data: result, summary: `${result.length} ruta(s).` };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Excepción inesperada',
      };
    }
  },
};

// ============================================================================
// search_stores
// ============================================================================
interface SearchStoresArgs {
  query: string;
  zone_id?: string;
  limit?: number;
}

interface StoreSummary {
  id: string;
  code: string;
  name: string;
  address: string;
  zone_id: string;
  zone_name: string | null;
  lat: number;
  lng: number;
  is_active: boolean;
}

const search_stores: ToolDefinition<SearchStoresArgs, StoreSummary[]> = {
  name: 'search_stores',
  description:
    'Busca tiendas por nombre o código. Usa esta tool cuando el usuario menciona una tienda — NUNCA inventes el código. La búsqueda es case-insensitive y match parcial en code o name.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Texto a buscar en code o name de la tienda. Mínimo 2 caracteres.',
      },
      zone_id: {
        type: 'string',
        description: 'Opcional. UUID de zona para restringir la búsqueda.',
        format: 'uuid',
      },
      limit: {
        type: 'integer',
        description: 'Máximo de resultados. Default 20.',
      },
    },
    required: ['query'],
  },
  handler: async (args, ctx): Promise<ToolResult<StoreSummary[]>> => {
    try {
      const q = (args.query ?? '').trim();
      if (q.length < 2) {
        return { ok: false, error: 'Query debe tener al menos 2 caracteres.' };
      }

      // Search case-insensitive en code OR name.
      let qb = ctx.supabase
        .from('stores')
        .select('id, code, name, address, zone_id, lat, lng, is_active, zones:zone_id ( name )')
        .eq('customer_id', ctx.customerId)
        .or(`code.ilike.%${q}%,name.ilike.%${q}%`)
        .eq('is_active', true)
        .limit(args.limit ?? 20);

      if (args.zone_id) qb = qb.eq('zone_id', args.zone_id);

      const { data, error } = await qb;
      if (error) return { ok: false, error: `Error de BD: ${error.message}` };

      const result: StoreSummary[] = ((data ?? []) as unknown as Array<{
        id: string;
        code: string;
        name: string;
        address: string;
        zone_id: string;
        lat: number;
        lng: number;
        is_active: boolean;
        zones: { name: string } | null;
      }>).map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        address: s.address,
        zone_id: s.zone_id,
        zone_name: s.zones?.name ?? null,
        lat: s.lat,
        lng: s.lng,
        is_active: s.is_active,
      }));

      return {
        ok: true,
        data: result,
        summary:
          result.length === 0
            ? `Ninguna tienda match para "${q}". Verifica con el usuario el nombre o código.`
            : `${result.length} tienda(s) encontrada(s).`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Excepción inesperada',
      };
    }
  },
};

// ============================================================================
// list_available_drivers
// ============================================================================
interface ListAvailableDriversArgs {
  date: string;
  zone_id?: string;
}

interface DriverAvailability {
  id: string;
  user_id: string;
  full_name: string;
  zone_id: string;
  zone_name: string | null;
  license_number: string | null;
  has_route_on_date: boolean;
}

const list_available_drivers: ToolDefinition<ListAvailableDriversArgs, DriverAvailability[]> = {
  name: 'list_available_drivers',
  description:
    'Lista los choferes activos del customer y marca si tienen ruta asignada en la fecha dada. Úsala cuando el usuario quiere asignar un chofer a una ruta nueva o reemplazar uno.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Fecha en formato YYYY-MM-DD. Día operativo a verificar.',
        format: 'date',
      },
      zone_id: {
        type: 'string',
        description: 'Opcional. UUID de zona para filtrar.',
        format: 'uuid',
      },
    },
    required: ['date'],
  },
  handler: async (args, ctx): Promise<ToolResult<DriverAvailability[]>> => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        return { ok: false, error: 'date debe estar en formato YYYY-MM-DD.' };
      }

      let qb = ctx.supabase
        .from('drivers')
        .select(`
          id, user_id, zone_id, license_number,
          user_profiles:user_id ( full_name, is_active ),
          zones:zone_id ( name )
        `)
        .eq('customer_id', ctx.customerId)
        .eq('is_active', true);

      if (args.zone_id) qb = qb.eq('zone_id', args.zone_id);

      const { data, error } = await qb;
      if (error) return { ok: false, error: `Error de BD: ${error.message}` };

      const drivers = (data ?? []) as unknown as Array<{
        id: string;
        user_id: string;
        zone_id: string;
        license_number: string | null;
        user_profiles: { full_name: string; is_active: boolean } | null;
        zones: { name: string } | null;
      }>;

      const active = drivers.filter((d) => d.user_profiles?.is_active);
      if (active.length === 0) {
        return { ok: true, data: [], summary: 'Sin choferes activos.' };
      }

      // Rutas asignadas para la fecha pedida.
      const driverIds = active.map((d) => d.id);
      const { data: routes } = await ctx.supabase
        .from('routes')
        .select('driver_id')
        .eq('customer_id', ctx.customerId)
        .eq('date', args.date)
        .in('driver_id', driverIds)
        .in('status', ['PUBLISHED', 'IN_PROGRESS', 'APPROVED', 'OPTIMIZED', 'DRAFT']);
      const busyDrivers = new Set((routes ?? []).map((r) => r.driver_id as string));

      const result: DriverAvailability[] = active.map((d) => ({
        id: d.id,
        user_id: d.user_id,
        full_name: d.user_profiles?.full_name ?? '(sin nombre)',
        zone_id: d.zone_id,
        zone_name: d.zones?.name ?? null,
        license_number: d.license_number,
        has_route_on_date: busyDrivers.has(d.id),
      }));

      const free = result.filter((d) => !d.has_route_on_date).length;
      return {
        ok: true,
        data: result,
        summary: `${result.length} chofer(es) activos, ${free} libre(s) para ${args.date}.`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Excepción inesperada',
      };
    }
  },
};

// ============================================================================
// list_available_vehicles
// ============================================================================
interface ListAvailableVehiclesArgs {
  date: string;
  zone_id?: string;
}

interface VehicleAvailability {
  id: string;
  plate: string;
  alias: string | null;
  zone_id: string;
  zone_name: string | null;
  capacity: number[];
  status: string;
  has_route_on_date: boolean;
}

const list_available_vehicles: ToolDefinition<ListAvailableVehiclesArgs, VehicleAvailability[]> = {
  name: 'list_available_vehicles',
  description:
    'Lista los vehículos activos del customer y marca si tienen ruta asignada en la fecha dada. Úsala para asignar camionetas a rutas nuevas.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      date: {
        type: 'string',
        description: 'Fecha en formato YYYY-MM-DD.',
        format: 'date',
      },
      zone_id: {
        type: 'string',
        description: 'Opcional. UUID de zona.',
        format: 'uuid',
      },
    },
    required: ['date'],
  },
  handler: async (args, ctx): Promise<ToolResult<VehicleAvailability[]>> => {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
        return { ok: false, error: 'date debe estar en formato YYYY-MM-DD.' };
      }

      let qb = ctx.supabase
        .from('vehicles')
        .select(`
          id, plate, alias, zone_id, capacity, status,
          zones:zone_id ( name )
        `)
        .eq('customer_id', ctx.customerId)
        .eq('is_active', true);

      if (args.zone_id) qb = qb.eq('zone_id', args.zone_id);

      const { data, error } = await qb;
      if (error) return { ok: false, error: `Error de BD: ${error.message}` };

      const vehicles = (data ?? []) as unknown as Array<{
        id: string;
        plate: string;
        alias: string | null;
        zone_id: string;
        capacity: number[];
        status: string;
        zones: { name: string } | null;
      }>;

      if (vehicles.length === 0) {
        return { ok: true, data: [], summary: 'Sin vehículos activos.' };
      }

      const vehicleIds = vehicles.map((v) => v.id);
      const { data: routes } = await ctx.supabase
        .from('routes')
        .select('vehicle_id')
        .eq('customer_id', ctx.customerId)
        .eq('date', args.date)
        .in('vehicle_id', vehicleIds)
        .in('status', ['PUBLISHED', 'IN_PROGRESS', 'APPROVED', 'OPTIMIZED', 'DRAFT']);
      const busy = new Set((routes ?? []).map((r) => r.vehicle_id as string));

      const result: VehicleAvailability[] = vehicles.map((v) => ({
        id: v.id,
        plate: v.plate,
        alias: v.alias,
        zone_id: v.zone_id,
        zone_name: v.zones?.name ?? null,
        capacity: v.capacity,
        status: v.status,
        has_route_on_date: busy.has(v.id),
      }));

      const free = result.filter((v) => !v.has_route_on_date).length;
      return {
        ok: true,
        data: result,
        summary: `${result.length} vehículo(s) activos, ${free} libre(s) para ${args.date}.`,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Excepción inesperada',
      };
    }
  },
};

// ============================================================================
// Registry export
// ============================================================================
export const READ_TOOLS: ReadonlyArray<ToolDefinition> = [
  list_dispatches_today,
  list_routes,
  search_stores,
  list_available_drivers,
  list_available_vehicles,
] as unknown as ReadonlyArray<ToolDefinition>;
