// Endpoint INTERNO para apply_route_plan (OE-3). Solo lo llama el tool
// homónimo del orchestrator vía fetch local con INTERNAL_AGENT_TOKEN.
//
// Toma: dispatch_id + vehicle_ids + driver_ids (la asignación que el user
// eligió de las alternativas de propose_route_plan) y re-estructura el tiro
// reusando la maquinaria probada de restructureDispatchInternal (RPC
// atómica + rollback automático si optimizer falla, ADR-053).
//
// Hardening C1: customer_id derivado server-side del caller (no del body).

import 'server-only';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { listRoutesByDispatch } from '@/lib/queries/dispatches';
import { listStopsForRoute } from '@/lib/queries/stops';
import { computeOptimizationPlan } from '@/lib/optimizer-pipeline';
import { logger } from '@tripdrive/observability';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 90; // VROOM puede tardar 30-60s con N vehículos.

interface ApplyPlanBody {
  dispatch_id: string;
  /**
   * Fast path (OE-3.1): proposal_id + alternative_id. Lee el plan completo
   * del cache `route_plan_proposals`, salta VROOM, va directo al RPC.
   * Latencia ~500ms vs 30-60s del path legacy.
   */
  proposal_id?: string;
  alternative_id?: string;
  /**
   * Legacy path: vehicle_ids + driver_ids. Re-corre VROOM. Se mantiene como
   * fallback si el cache expiró (TTL 30min) o si el caller no usa proposal.
   */
  vehicle_ids?: string[];
  driver_ids?: Array<string | null>;
  /** Etiqueta para audit (cheapest/balanced/fastest). */
  applied_label?: string;
  caller_user_id: string;
}

const UUID_RE = /^[0-9a-f-]{36}$/i;

export async function POST(req: Request) {
  // 1. Token interno.
  const token = req.headers.get('x-internal-agent-token');
  const expected = process.env.INTERNAL_AGENT_TOKEN;
  if (!expected || token !== expected) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: ApplyPlanBody;
  try {
    body = (await req.json()) as ApplyPlanBody;
  } catch {
    return Response.json({ error: 'json inválido' }, { status: 400 });
  }

  if (!UUID_RE.test(body.dispatch_id)) {
    return Response.json({ error: 'dispatch_id inválido' }, { status: 400 });
  }
  if (!UUID_RE.test(body.caller_user_id)) {
    return Response.json({ error: 'caller_user_id requerido' }, { status: 400 });
  }

  // Fast path (OE-3.1) o legacy path? Si proposal_id+alternative_id están
  // presentes, intentamos el fast path. Si no, requiere vehicle_ids legacy.
  const isFastPath = Boolean(body.proposal_id && body.alternative_id);

  if (!isFastPath) {
    if (!Array.isArray(body.vehicle_ids) || body.vehicle_ids.length === 0) {
      return Response.json(
        { error: 'vehicle_ids vacío (o pasa proposal_id + alternative_id para fast path)' },
        { status: 400 },
      );
    }
    for (const vid of body.vehicle_ids) {
      if (!UUID_RE.test(vid)) {
        return Response.json({ error: `vehicle_id inválido: ${vid}` }, { status: 400 });
      }
    }
    const driverIdsCount = body.driver_ids?.length ?? body.vehicle_ids.length;
    if (driverIdsCount !== body.vehicle_ids.length) {
      return Response.json(
        { error: 'driver_ids debe alinear 1-a-1 con vehicle_ids' },
        { status: 400 },
      );
    }
  } else {
    if (!UUID_RE.test(body.proposal_id!)) {
      return Response.json({ error: 'proposal_id inválido' }, { status: 400 });
    }
  }

  const admin = createServiceRoleClient();

  // 2. HARDENING C1: customer_id del caller (no del body).
  const { data: callerProfile } = await admin
    .from('user_profiles')
    .select('customer_id, role, is_active')
    .eq('id', body.caller_user_id)
    .maybeSingle();
  if (!callerProfile || !callerProfile.is_active) {
    return Response.json({ error: 'caller no autorizado' }, { status: 403 });
  }
  if (!['admin', 'dispatcher'].includes(callerProfile.role as string)) {
    return Response.json({ error: 'caller sin permisos para aplicar planes' }, { status: 403 });
  }
  const callerCustomerId = callerProfile.customer_id as string;

  // 3. Validar que el dispatch pertenezca al customer del caller.
  const { data: dispatch, error: dErr } = await admin
    .from('dispatches')
    .select('id, customer_id, name, date, zone_id')
    .eq('id', body.dispatch_id)
    .maybeSingle();
  if (dErr || !dispatch) {
    return Response.json({ error: 'dispatch no encontrado' }, { status: 404 });
  }
  if (dispatch.customer_id !== callerCustomerId) {
    return Response.json({ error: 'dispatch no pertenece al caller' }, { status: 403 });
  }

  // 4. Validar estado del dispatch (pre-publicación).
  const routes = await listRoutesByDispatch(body.dispatch_id);
  const liveRoutes = routes.filter((r) => r.status !== 'CANCELLED');
  const POST_PUBLISH = new Set(['PUBLISHED', 'IN_PROGRESS', 'INTERRUPTED', 'COMPLETED']);
  const blocking = liveRoutes.find((r) => POST_PUBLISH.has(r.status));
  if (blocking) {
    return Response.json(
      {
        error: `Ruta "${blocking.name}" está ${blocking.status} — no se puede reestructurar el tiro.`,
      },
      { status: 409 },
    );
  }

  // 5. Obtener el plan a aplicar. Dos paths:
  //    - Fast path (OE-3.1): lee del cache route_plan_proposals. ~50ms.
  //    - Legacy path: corre VROOM con vehicle_ids del body. ~30-60s.
  type Plan = {
    routes: Array<{
      vehicleId: string;
      driverId: string | null;
      depotOverrideId: string | null;
      name: string;
      totalDistanceMeters: number;
      totalDurationSeconds: number;
      estimatedStartAt: string;
      estimatedEndAt: string;
      stops: Array<{
        storeId: string;
        sequence: number;
        plannedArrivalAt: string;
        plannedDepartureAt: string;
        load: number[];
      }>;
    }>;
    unassignedStoreIds: string[];
    totalDistanceMeters: number;
    totalDurationSeconds: number;
  };
  let plan: Plan;

  if (isFastPath) {
    const { data: proposal, error: pErr } = await admin
      .from('route_plan_proposals')
      .select('id, customer_id, dispatch_id, payload, expires_at')
      .eq('id', body.proposal_id!)
      .maybeSingle();
    if (pErr || !proposal) {
      return Response.json(
        { error: 'proposal no encontrada (puede haber expirado)' },
        { status: 404 },
      );
    }
    if (proposal.customer_id !== callerCustomerId) {
      return Response.json({ error: 'proposal no pertenece al caller' }, { status: 403 });
    }
    if (new Date(proposal.expires_at as string).getTime() < Date.now()) {
      return Response.json(
        { error: 'proposal expirada (TTL 30min) — vuelve a generar propuestas' },
        { status: 410 },
      );
    }
    const payload = proposal.payload as {
      fullPlansByAltId?: Record<string, Plan | null>;
    } | null;
    const cachedPlan = payload?.fullPlansByAltId?.[body.alternative_id!];
    if (!cachedPlan) {
      return Response.json(
        { error: `alternative_id "${body.alternative_id}" no existe en esta propuesta` },
        { status: 400 },
      );
    }
    plan = cachedPlan;
  } else {
    // Legacy path — re-compute VROOM con vehículos explícitos.
    const driverIds = body.driver_ids ?? body.vehicle_ids!.map(() => null);
    const { data: vehicleRows } = await admin
      .from('vehicles')
      .select('id')
      .eq('customer_id', callerCustomerId)
      .in('id', body.vehicle_ids!);
    if (!vehicleRows || vehicleRows.length !== body.vehicle_ids!.length) {
      return Response.json(
        { error: 'algún vehicle_id no existe o no pertenece al caller' },
        { status: 400 },
      );
    }

    const allStoreIds: string[] = [];
    const seen = new Set<string>();
    for (const r of liveRoutes) {
      const stops = await listStopsForRoute(r.id);
      for (const s of stops) {
        if (!seen.has(s.storeId)) {
          seen.add(s.storeId);
          allStoreIds.push(s.storeId);
        }
      }
    }
    if (allStoreIds.length === 0) {
      return Response.json({ error: 'el tiro no tiene paradas' }, { status: 400 });
    }

    try {
      plan = await computeOptimizationPlan({
        date: dispatch.date as string,
        vehicleIds: body.vehicle_ids!,
        driverIds,
        storeIds: allStoreIds,
        routeNamePrefix: dispatch.name as string,
      });
    } catch (err) {
      logger.error('apply_plan.optimizer_failed', {
        dispatch_id: body.dispatch_id,
        err: err instanceof Error ? err.message : String(err),
      });
      return Response.json(
        { error: `optimizer falló: ${err instanceof Error ? err.message : 'desconocido'}` },
        { status: 502 },
      );
    }
    if (plan.routes.length === 0) {
      return Response.json(
        { error: 'el optimizer no asignó ninguna parada — revisar capacidad' },
        { status: 422 },
      );
    }
  }

  // 8. RPC atómica para swap del tiro.
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
      p_dispatch_id: body.dispatch_id,
      p_old_route_ids: oldRouteIds,
      p_routes_json: routesJson,
      p_created_by: body.caller_user_id,
    },
  );

  if (rpcErr) {
    logger.error('apply_plan.rpc_failed', {
      dispatch_id: body.dispatch_id,
      err: rpcErr.message,
    });
    return Response.json({ error: `RPC falló: ${rpcErr.message}` }, { status: 500 });
  }

  logger.info('apply_plan.applied', {
    dispatch_id: body.dispatch_id,
    applied_label: body.applied_label,
    path: isFastPath ? 'fast_cache' : 'legacy_vroom',
    new_route_count: (newRouteIds as unknown as string[])?.length ?? 0,
    triggered_by: body.caller_user_id,
  });

  return Response.json({
    ok: true,
    dispatch_id: body.dispatch_id,
    applied_label: body.applied_label,
    new_route_ids: newRouteIds,
    total_distance_meters: plan.totalDistanceMeters,
    total_duration_seconds: plan.totalDurationSeconds,
    unassigned_store_ids: plan.unassignedStoreIds,
  });
}
