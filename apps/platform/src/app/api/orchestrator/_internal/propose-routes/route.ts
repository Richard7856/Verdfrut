// Endpoint INTERNO — Capa 4 del Optimization Engine (ADR-100 / OE-2).
//
// Calcula 2-3 alternativas de plan para un set de stops, con ranking
// (cheapest / balanced / fastest) y breakdown de costo MXN.
//
// NO toca BD: solo lee customer config + stores/vehicles, llama VROOM N
// veces por opción, y devuelve estructura JSON. La materialización
// (apply_route_plan) es endpoint separado en OE-3.
//
// Seguridad: mismo patrón que /optimize (ADR-095 / HARDENING C1):
//   - token interno `INTERNAL_AGENT_TOKEN` para identificar al server caller.
//   - customer_id DERIVADO server-side desde user_profiles del caller_user_id.
//   - NUNCA acepta customer_id del body (defensa contra request forging).
//
// Inputs aceptados (uno de los 3 modos):
//   A) dispatch_id existente → reutilizar sus stops y vehicles
//   B) stop_ids + vehicle_ids explícitos → modo "manual"
//   C) stop_ids + zone_id → toma todos los vehículos activos de la zona

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { proposePlans, type ProposePlansOutput } from '@/lib/propose-plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hasta 5 alternativas × N clusters × VROOM 5-15s = ~75s peor caso.
export const maxDuration = 90;

interface ProposeBody {
  /** Modo A: deriva stops + vehicles del dispatch. */
  dispatch_id?: string;
  /** Modo B/C: stops explícitos. */
  stop_ids?: string[];
  /** Modo B: vehicles explícitos. */
  vehicle_ids?: string[];
  /** Modo C: zone para autodetectar vehicles. */
  zone_id?: string;
  /** Fecha YYYY-MM-DD. Default: hoy. */
  date?: string;
  shift_start?: string;
  shift_end?: string;
  /** Trusted: derivamos customer_id desde user_profiles. */
  caller_user_id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  // 1. Validar token interno.
  const token = req.headers.get('x-internal-agent-token');
  const expected = process.env.INTERNAL_AGENT_TOKEN;
  if (!expected || token !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ProposeBody;
  try {
    body = (await req.json()) as ProposeBody;
  } catch {
    return Response.json({ error: 'json inválido' }, { status: 400 });
  }

  if (!body.caller_user_id || !UUID_RE.test(body.caller_user_id)) {
    return Response.json({ error: 'caller_user_id requerido' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // 2. HARDENING C1: derivar customer_id server-side.
  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('customer_id, role, is_active')
    .eq('id', body.caller_user_id)
    .maybeSingle();
  if (!callerProfile || !callerProfile.is_active) {
    return Response.json({ error: 'caller no autorizado' }, { status: 403 });
  }
  if (!['admin', 'dispatcher'].includes(callerProfile.role as string)) {
    return Response.json({ error: 'caller sin permisos' }, { status: 403 });
  }
  const customerId = callerProfile.customer_id as string;

  // 3. Resolver stops + vehicles según modo.
  let storeIds: string[];
  let vehicleIds: string[];
  let dispatchInfo: { id: string; name: string; date: string } | null = null;
  const dateForRun = body.date ?? new Date().toISOString().slice(0, 10);

  if (body.dispatch_id) {
    // Modo A: leer del dispatch.
    if (!UUID_RE.test(body.dispatch_id)) {
      return Response.json({ error: 'dispatch_id inválido' }, { status: 400 });
    }
    const { data: dispatch } = await admin
      .from('dispatches')
      .select('id, name, date, zone_id, status')
      .eq('id', body.dispatch_id)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (!dispatch) {
      return Response.json({ error: 'tiro no encontrado' }, { status: 404 });
    }
    dispatchInfo = {
      id: dispatch.id as string,
      name: dispatch.name as string,
      date: dispatch.date as string,
    };

    const { data: routes } = await admin
      .from('routes')
      .select('id, vehicle_id')
      .eq('customer_id', customerId)
      .eq('dispatch_id', body.dispatch_id)
      .not('status', 'in', '(CANCELLED)');

    const routeIds = (routes ?? []).map((r) => r.id as string);
    const vehiclesFromRoutes = (routes ?? []).map((r) => r.vehicle_id as string);

    if (routeIds.length === 0) {
      return Response.json(
        { error: 'El tiro no tiene rutas — agrega al menos una con tiendas antes de proponer.' },
        { status: 400 },
      );
    }

    const { data: stops } = await admin
      .from('stops')
      .select('store_id')
      .in('route_id', routeIds);
    const seen = new Set<string>();
    storeIds = [];
    for (const s of stops ?? []) {
      const id = s.store_id as string;
      if (!seen.has(id)) {
        seen.add(id);
        storeIds.push(id);
      }
    }

    // Para vehicles: incluir los del dispatch + cualquier otro activo de la
    // misma zona (para que el optimizer pueda proponer K mayor si conviene).
    const dispatchZoneId = dispatch.zone_id as string;
    const { data: zoneVehicles } = await admin
      .from('vehicles')
      .select('id')
      .eq('customer_id', customerId)
      .eq('zone_id', dispatchZoneId)
      .eq('is_active', true);
    const allZoneVids = (zoneVehicles ?? []).map((v) => v.id as string);
    vehicleIds = Array.from(new Set([...vehiclesFromRoutes, ...allZoneVids]));
  } else if (body.stop_ids && body.stop_ids.length > 0) {
    storeIds = body.stop_ids.filter((s) => typeof s === 'string' && UUID_RE.test(s));
    if (storeIds.length === 0) {
      return Response.json({ error: 'stop_ids no contiene UUIDs válidos' }, { status: 400 });
    }

    if (body.vehicle_ids && body.vehicle_ids.length > 0) {
      // Modo B.
      vehicleIds = body.vehicle_ids.filter((v) => typeof v === 'string' && UUID_RE.test(v));
    } else if (body.zone_id) {
      // Modo C.
      if (!UUID_RE.test(body.zone_id)) {
        return Response.json({ error: 'zone_id inválido' }, { status: 400 });
      }
      const { data: zoneVehicles } = await admin
        .from('vehicles')
        .select('id')
        .eq('customer_id', customerId)
        .eq('zone_id', body.zone_id)
        .eq('is_active', true);
      vehicleIds = (zoneVehicles ?? []).map((v) => v.id as string);
    } else {
      return Response.json(
        { error: 'Pasa vehicle_ids o zone_id para resolver qué vehículos usar.' },
        { status: 400 },
      );
    }

    if (vehicleIds.length === 0) {
      return Response.json({ error: 'No hay vehículos disponibles para esta operación.' }, { status: 400 });
    }
  } else {
    return Response.json(
      { error: 'Pasa dispatch_id, o (stop_ids + vehicle_ids|zone_id).' },
      { status: 400 },
    );
  }

  if (storeIds.length === 0) {
    return Response.json({ error: 'storeIds vacío después de filtrar.' }, { status: 400 });
  }

  // 4. Llamar al pipeline de proposePlans.
  let output: ProposePlansOutput;
  try {
    output = await proposePlans({
      customerId,
      date: dispatchInfo?.date ?? dateForRun,
      storeIds,
      availableVehicleIds: vehicleIds,
      shiftStart: body.shift_start,
      shiftEnd: body.shift_end,
      routeNamePrefix: dispatchInfo?.name ?? 'Plan propuesto',
    });
  } catch (err) {
    return Response.json(
      { error: `proposePlans falló: ${err instanceof Error ? err.message : 'desconocido'}` },
      { status: 502 },
    );
  }

  return Response.json({
    ok: true,
    dispatch: dispatchInfo,
    inputs: {
      store_count: storeIds.length,
      vehicle_count_available: vehicleIds.length,
      date: dispatchInfo?.date ?? dateForRun,
    },
    costs_config: output.costsConfig,
    k_explored: output.kExplored,
    total_evaluated: output.totalEvaluated,
    single_option_mode: output.singleOptionMode,
    always_unassigned_store_ids: output.alwaysUnassignedStoreIds,
    alternatives: output.alternatives.map((a) => ({
      id: a.id,
      labels: a.labels,
      vehicle_count: a.vehicleCount,
      feasible: a.feasible,
      metrics: {
        total_km: round1(a.metrics.totalKm),
        total_driver_hours: round1(a.metrics.totalDriverHours),
        max_driver_hours: round1(a.metrics.maxDriverHours),
      },
      cost: a.cost,
      routes: a.routes.map((r) => ({
        vehicle_id: r.vehicleId,
        driver_id: r.driverId,
        stop_count: r.stopCount,
        distance_km: round1(r.distanceKm),
        duration_hours: round1(r.durationHours),
      })),
    })),
  });
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
