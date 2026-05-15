// Endpoint INTERNO — solo invocado por el orquestador AI desde la misma
// app vía fetch. NO autenticación de user; valida `x-internal-agent-token`
// header.
//
// Razón: el tool `optimize_dispatch` del package @tripdrive/orchestrator
// necesita ejecutar la lógica de `optimizer-pipeline.ts` que importa
// muchos módulos internos del platform. En lugar de mover toda la lógica
// al package, exponemos este endpoint que el tool llama por HTTP local.
//
// Token: ANTHROPIC_API_KEY ya identifica al server caller; usamos un
// token adicional `INTERNAL_AGENT_TOKEN` para que solo este flow del
// orquestador llame el endpoint (no third parties).

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { computeOptimizationPlan, type OptimizationPlan } from '@/lib/optimizer-pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // optimizer puede tardar 5-15s.

interface OptimizeBody {
  dispatch_id: string;
  /** Si vacío, usa los vehículos actuales del tiro. */
  vehicle_ids?: string[];
  /** Paralelo a vehicle_ids; null = sin asignar. */
  driver_ids?: Array<string | null>;
  /** false (default) = solo calcular plan. true = aplicar via RPC. */
  apply?: boolean;
  /**
   * Identidad del caller — solo `caller_user_id` es trusted.
   *
   * ADR-095 / HARDENING C1: el `customer_id` NUNCA se acepta del body —
   * lo derivamos server-side desde `user_profiles` para evitar que un
   * atacante con `INTERNAL_AGENT_TOKEN` reescriba dispatches de tenants
   * arbitrarios. Si el body trae `caller_customer_id`, se ignora.
   */
  caller_user_id: string;
}

export async function POST(req: Request) {
  // 1. Validar token interno.
  const token = req.headers.get('x-internal-agent-token');
  const expected = process.env.INTERNAL_AGENT_TOKEN;
  if (!expected || token !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: OptimizeBody;
  try {
    body = (await req.json()) as OptimizeBody;
  } catch {
    return Response.json({ error: 'json inválido' }, { status: 400 });
  }

  const dispatchId = body.dispatch_id;
  if (!dispatchId || !/^[0-9a-f-]{36}$/i.test(dispatchId)) {
    return Response.json({ error: 'dispatch_id inválido' }, { status: 400 });
  }
  if (!body.caller_user_id || !/^[0-9a-f-]{36}$/i.test(body.caller_user_id)) {
    return Response.json({ error: 'caller_user_id requerido' }, { status: 400 });
  }

  const admin = createServiceRoleClient();

  // 2. HARDENING C1: derivar customer_id desde user_profiles del caller.
  // Esto blinda contra request forging del customer_id en el body.
  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('customer_id, role, is_active')
    .eq('id', body.caller_user_id)
    .maybeSingle();
  if (!callerProfile || !callerProfile.is_active) {
    return Response.json({ error: 'caller no autorizado' }, { status: 403 });
  }
  if (!['admin', 'dispatcher'].includes(callerProfile.role as string)) {
    return Response.json({ error: 'caller sin permisos para optimizar' }, { status: 403 });
  }
  const callerCustomerId = callerProfile.customer_id as string;

  // 3. Cargar dispatch + rutas vivas + stores únicos.
  const { data: dispatch } = await admin
    .from('dispatches')
    .select('id, name, date, zone_id, status')
    .eq('id', dispatchId)
    .eq('customer_id', callerCustomerId)
    .maybeSingle();
  if (!dispatch) {
    return Response.json({ error: 'tiro no encontrado' }, { status: 404 });
  }
  if (dispatch.status === 'cancelled' || dispatch.status === 'completed') {
    return Response.json(
      { error: `Tiro en estado ${dispatch.status} no se puede re-rutear` },
      { status: 409 },
    );
  }

  const { data: routes } = await admin
    .from('routes')
    .select('id, name, vehicle_id, driver_id, status, depot_override_id, total_distance_meters, total_duration_seconds')
    .eq('customer_id', callerCustomerId)
    .eq('dispatch_id', dispatchId)
    .not('status', 'in', '(CANCELLED)');

  const liveRoutes = (routes ?? []) as Array<{
    id: string;
    name: string;
    vehicle_id: string;
    driver_id: string | null;
    status: string;
    depot_override_id: string | null;
    total_distance_meters: number | null;
    total_duration_seconds: number | null;
  }>;

  const POST_PUBLISH = ['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED'];
  const blocking = liveRoutes.find((r) => POST_PUBLISH.includes(r.status));
  if (blocking) {
    return Response.json(
      {
        error: `No se puede re-rutear: la ruta "${blocking.name}" está ${blocking.status}.`,
      },
      { status: 409 },
    );
  }

  // 3. Recolectar storeIds + depot overrides previos.
  const routeIds = liveRoutes.map((r) => r.id);
  let allStoreIds: string[] = [];
  if (routeIds.length > 0) {
    const { data: stops } = await admin
      .from('stops')
      .select('store_id, route_id, sequence')
      .in('route_id', routeIds)
      .order('sequence', { ascending: true });
    const seen = new Set<string>();
    for (const s of stops ?? []) {
      const id = s.store_id as string;
      if (!seen.has(id)) {
        seen.add(id);
        allStoreIds.push(id);
      }
    }
  }
  if (allStoreIds.length === 0) {
    return Response.json(
      { error: 'El tiro no tiene paradas — agrega rutas con tiendas antes de optimizar.' },
      { status: 400 },
    );
  }

  // 4. Construir vehicle/driver assignments: usar input o las rutas actuales.
  let vehicleIds: string[];
  let driverIds: Array<string | null>;
  if (body.vehicle_ids && body.vehicle_ids.length > 0) {
    vehicleIds = body.vehicle_ids;
    driverIds = body.driver_ids ?? vehicleIds.map(() => null);
  } else {
    vehicleIds = liveRoutes.map((r) => r.vehicle_id);
    driverIds = liveRoutes.map((r) => r.driver_id);
  }

  const oldOverridesByVehicle = new Map<string, string>();
  for (const r of liveRoutes) {
    if (r.depot_override_id) {
      oldOverridesByVehicle.set(r.vehicle_id, r.depot_override_id);
    }
  }
  const newVehicleSet = new Set(vehicleIds);
  const preservedOverrides = new Map<string, string>();
  for (const [v, d] of oldOverridesByVehicle.entries()) {
    if (newVehicleSet.has(v)) preservedOverrides.set(v, d);
  }

  // 5. Snapshot ANTES (para comparativa en la response).
  const before = {
    routeCount: liveRoutes.length,
    totalDistanceMeters: liveRoutes.reduce(
      (s, r) => s + (r.total_distance_meters ?? 0),
      0,
    ),
    totalDurationSeconds: liveRoutes.reduce(
      (s, r) => s + (r.total_duration_seconds ?? 0),
      0,
    ),
    storeCount: allStoreIds.length,
  };

  // 6. Llamar optimizer pipeline (FASE 1 — solo cálculo, no toca BD).
  let plan: OptimizationPlan;
  try {
    plan = await computeOptimizationPlan({
      date: dispatch.date as string,
      vehicleIds,
      driverIds,
      storeIds: allStoreIds,
      vehicleDepotOverrides:
        preservedOverrides.size > 0 ? preservedOverrides : undefined,
      routeNamePrefix: dispatch.name as string,
    });
  } catch (err) {
    return Response.json(
      {
        error: `Optimizer falló: ${err instanceof Error ? err.message : 'desconocido'}`,
      },
      { status: 502 },
    );
  }

  const after = {
    routeCount: plan.routes.length,
    totalDistanceMeters: plan.totalDistanceMeters,
    totalDurationSeconds: plan.totalDurationSeconds,
    storeCount: allStoreIds.length - plan.unassignedStoreIds.length,
    unassignedStoreIds: plan.unassignedStoreIds,
  };

  // 7. Si apply=false → retornar plan + comparativa sin escribir.
  if (!body.apply) {
    return Response.json({
      ok: true,
      applied: false,
      dispatch: { id: dispatch.id, name: dispatch.name, date: dispatch.date },
      before,
      after,
      routes: plan.routes.map((r) => ({
        name: r.name,
        vehicle_id: r.vehicleId,
        driver_id: r.driverId,
        total_distance_meters: r.totalDistanceMeters,
        total_duration_seconds: r.totalDurationSeconds,
        stop_count: r.stops.length,
        store_ids: r.stops.map((s) => s.storeId),
      })),
    });
  }

  // 8. Si apply=true → FASE 2: ejecutar RPC atómica.
  const oldRouteIds = liveRoutes.map((r) => r.id);
  const routesJson = plan.routes.map((r) => ({
    vehicle_id: r.vehicleId,
    driver_id: r.driverId ?? '',
    depot_override_id: r.depotOverrideId ?? '',
    name: r.name,
    total_distance_meters: r.totalDistanceMeters,
    total_duration_seconds: r.totalDurationSeconds,
    estimated_start_at: r.estimatedStartAt,
    estimated_end_at: r.estimatedEndAt,
    stops: r.stops.map((s) => ({
      store_id: s.storeId,
      sequence: s.sequence,
      planned_arrival_at: s.plannedArrivalAt,
      planned_departure_at: s.plannedDepartureAt,
      load: s.load,
    })),
  }));

  const { data: newRouteIds, error: rpcErr } = await admin.rpc(
    'tripdrive_restructure_dispatch',
    {
      p_dispatch_id: dispatchId,
      p_old_route_ids: oldRouteIds,
      p_routes_json: routesJson as never,
      p_created_by: body.caller_user_id,
    },
  );

  if (rpcErr) {
    return Response.json(
      { error: `RPC restructure falló: ${rpcErr.message}` },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    applied: true,
    dispatch: { id: dispatch.id, name: dispatch.name, date: dispatch.date },
    before,
    after,
    new_route_ids: (newRouteIds as unknown as string[]) ?? [],
    unassigned_store_ids: plan.unassignedStoreIds,
  });
}

