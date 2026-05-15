// Tool de optimización — re-rutea un tiro con VROOM + Google Routes.
//
// El handler hace fetch al endpoint interno del platform que envuelve
// `computeOptimizationPlan` + RPC `tripdrive_restructure_dispatch`. La
// separación existe porque `optimizer-pipeline.ts` importa decenas de
// módulos del platform que no podemos referenciar desde un package.
//
// El endpoint requiere header `x-internal-agent-token` que el tool lee de
// `process.env.INTERNAL_AGENT_TOKEN` (compartido entre tool y endpoint).
//
// is_write=true + requires_confirmation=true: redistribuir un tiro
// cancela rutas viejas e inserta nuevas atómicamente — alto impacto.

import type { ToolDefinition, ToolResult } from '../types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badArg<T = unknown>(field: string, msg: string): ToolResult<T> {
  return { ok: false, error: `Argumento inválido "${field}": ${msg}` };
}

interface OptimizeDispatchArgs {
  dispatch_id: string;
  vehicle_ids?: string[];
  driver_ids?: Array<string | null>;
  apply?: boolean;
}

interface OptimizeRoutePreview {
  name: string;
  vehicle_id: string;
  driver_id: string | null;
  total_distance_meters: number;
  total_duration_seconds: number;
  stop_count: number;
  store_ids: string[];
}

interface OptimizeResult {
  applied: boolean;
  dispatch: { id: string; name: string; date: string };
  before: {
    routeCount: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    storeCount: number;
  };
  after: {
    routeCount: number;
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    storeCount: number;
    unassignedStoreIds?: string[];
  };
  routes?: OptimizeRoutePreview[];
  new_route_ids?: string[];
  unassigned_store_ids?: string[];
  // Métricas humanas pre-calculadas para summary.
  distance_delta_pct: number;
  duration_delta_pct: number;
}

const optimize_dispatch: ToolDefinition<OptimizeDispatchArgs, OptimizeResult> = {
  name: 'optimize_dispatch',
  description:
    'Optimiza un tiro completo con VROOM + Google Routes: re-asigna tiendas entre camionetas + calcula secuencia óptima + ETAs con tráfico real. Si pasas vehicle_ids/driver_ids, los usa; si no, conserva los actuales. apply=false (default) calcula plan SIN escribir; apply=true ejecuta la reestructuración atómica. La operación es destructiva (cancela rutas viejas y crea nuevas).',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del tiro a optimizar.',
      },
      vehicle_ids: {
        type: 'array',
        description: 'UUIDs de vehículos a usar (opcional). Default: los mismos del tiro actual.',
        items: { type: 'string', description: 'UUID del vehículo.' },
      },
      driver_ids: {
        type: 'array',
        description: 'UUIDs de choferes paralelos a vehicle_ids. Usa "" o null para sin asignar.',
        items: { type: 'string', description: 'UUID del chofer (o vacío).' },
      },
      apply: {
        type: 'boolean',
        description: 'false (default) = solo calcular plan. true = ejecutar reestructuración. Pídele al usuario que apruebe primero con dry-run, después corre apply=true.',
      },
    },
    required: ['dispatch_id'],
  },
  handler: async (args, ctx): Promise<ToolResult<OptimizeResult>> => {
    if (!UUID_RE.test(args.dispatch_id)) return badArg('dispatch_id', 'UUID inválido.');

    const token = process.env.INTERNAL_AGENT_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: 'INTERNAL_AGENT_TOKEN no configurada en el servidor — pide al admin que la agregue en Vercel.',
      };
    }

    // Resolver URL del platform — mismo host en producción, localhost en dev.
    // Si está configurada PLATFORM_INTERNAL_URL la usamos; si no, asumimos
    // mismo host vía localhost:3000.
    const baseUrl = process.env.PLATFORM_INTERNAL_URL ?? 'http://localhost:3000';
    const url = `${baseUrl}/api/orchestrator/internal/optimize`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-agent-token': token,
        },
        body: JSON.stringify({
          dispatch_id: args.dispatch_id,
          vehicle_ids: args.vehicle_ids,
          driver_ids: args.driver_ids,
          apply: args.apply ?? false,
          // HARDENING C1: solo mandamos caller_user_id. El endpoint deriva el
          // customer_id desde user_profiles para evitar request forging.
          caller_user_id: ctx.userId,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Fetch falló.',
        recoverable: true,
      };
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({ error: 'sin detalle' }))) as {
        error?: string;
      };
      return { ok: false, error: errBody.error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as {
      applied: boolean;
      dispatch: { id: string; name: string; date: string };
      before: OptimizeResult['before'];
      after: OptimizeResult['after'];
      routes?: OptimizeRoutePreview[];
      new_route_ids?: string[];
      unassigned_store_ids?: string[];
    };

    // Métricas comparativas.
    const distanceDeltaPct =
      data.before.totalDistanceMeters > 0
        ? Math.round(
            ((data.after.totalDistanceMeters - data.before.totalDistanceMeters) /
              data.before.totalDistanceMeters) *
              1000,
          ) / 10
        : 0;
    const durationDeltaPct =
      data.before.totalDurationSeconds > 0
        ? Math.round(
            ((data.after.totalDurationSeconds - data.before.totalDurationSeconds) /
              data.before.totalDurationSeconds) *
              1000,
          ) / 10
        : 0;

    const summary = data.applied
      ? `✅ Tiro "${data.dispatch.name}" optimizado y publicado: ${data.after.routeCount} ruta(s), ${data.after.storeCount} parada(s). ${distanceDeltaPct >= 0 ? '+' : ''}${distanceDeltaPct}% distancia · ${durationDeltaPct >= 0 ? '+' : ''}${durationDeltaPct}% duración vs plan anterior.`
      : `📋 Plan calculado (no aplicado): ${data.after.routeCount} ruta(s), ${data.after.storeCount} parada(s). ${distanceDeltaPct >= 0 ? '+' : ''}${distanceDeltaPct}% distancia · ${durationDeltaPct >= 0 ? '+' : ''}${durationDeltaPct}% duración. Usa apply=true para ejecutar.`;

    return {
      ok: true,
      data: {
        ...data,
        distance_delta_pct: distanceDeltaPct,
        duration_delta_pct: durationDeltaPct,
      },
      summary,
    };
  },
};

// ============================================================================
// propose_route_plan — Capa 4 del Optimization Engine (OE-2 / ADR-100)
// ============================================================================

interface ProposeRoutePlanArgs {
  dispatch_id?: string;
  stop_ids?: string[];
  vehicle_ids?: string[];
  zone_id?: string;
  date?: string;
}

interface RoutePlanAlternative {
  id: string;
  labels: string[];
  vehicle_count: number;
  feasible: boolean;
  metrics: {
    total_km: number;
    total_driver_hours: number;
    max_driver_hours: number;
  };
  cost: {
    total_mxn: number;
    fuel_mxn: number;
    wear_mxn: number;
    labor_mxn: number;
    overhead_mxn: number;
  };
  routes: Array<{
    vehicle_id: string;
    driver_id: string | null;
    stop_count: number;
    distance_km: number;
    duration_hours: number;
  }>;
}

interface ProposeRoutePlanResult {
  dispatch: { id: string; name: string; date: string } | null;
  inputs: { store_count: number; vehicle_count_available: number; date: string };
  costs_config: {
    cost_per_km_fuel_mxn: number;
    cost_per_km_wear_mxn: number;
    driver_hourly_wage_mxn: number;
    dispatch_overhead_mxn: number;
    max_hours_per_driver: number;
    max_stops_per_vehicle: number;
  };
  k_explored: { minK: number; maxK: number };
  total_evaluated: number;
  always_unassigned_store_ids: string[];
  alternatives: RoutePlanAlternative[];
}

const propose_route_plan: ToolDefinition<ProposeRoutePlanArgs, ProposeRoutePlanResult> = {
  name: 'propose_route_plan',
  description:
    'Calcula 2-3 alternativas de plan de rutas para un tiro, con costo MXN, km totales, y jornada del chofer. Cada opción tiene labels: 💰 cheapest (menor costo), ⚖️ balanced (jornada ≤ 7h con costo razonable), ⚡ fastest (entrega más temprana). NO modifica nada — solo propone. El user elige cuál aplicar después. 3 modos input: (A) pasar `dispatch_id` para usar las tiendas/vehículos del tiro existente; (B) pasar `stop_ids` + `vehicle_ids` explícitos; (C) pasar `stop_ids` + `zone_id` para autodetectar vehículos activos de la zona. Cuando muestres resultados al user, formato: cada alternativa con sus labels emoji, km, jornada máx, y total $ MXN. Si dos alternativas coinciden en la misma opción, mostrar ambos labels en la misma card. Si hay tiendas en `always_unassigned_store_ids`, mencionarlas para que el user las revise antes de aplicar.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: {
        type: 'string',
        format: 'uuid',
        description: 'Modo A: UUID de un tiro existente. Usa sus tiendas y vehículos.',
      },
      stop_ids: {
        type: 'array',
        items: { type: 'string', description: 'UUID de una tienda/stop.' },
        description: 'Modo B/C: lista explícita de UUIDs de tiendas. Mínimo 1.',
      },
      vehicle_ids: {
        type: 'array',
        items: { type: 'string', description: 'UUID de vehículo.' },
        description: 'Modo B: lista explícita de vehículos. Requiere stop_ids.',
      },
      zone_id: {
        type: 'string',
        format: 'uuid',
        description: 'Modo C: UUID de zona. Autodetecta todos los vehículos activos de esa zona. Requiere stop_ids.',
      },
      date: {
        type: 'string',
        format: 'date',
        description: 'Fecha YYYY-MM-DD (default: hoy). Solo aplica en modos B/C.',
      },
    },
  },
  handler: async (args, ctx): Promise<ToolResult<ProposeRoutePlanResult>> => {
    // Validar al menos un modo.
    const hasModeA = Boolean(args.dispatch_id);
    const hasModeBC = Boolean(args.stop_ids?.length);
    if (!hasModeA && !hasModeBC) {
      return {
        ok: false,
        error: 'Pasa dispatch_id (modo A) o stop_ids + vehicle_ids/zone_id (modo B/C).',
      };
    }
    if (hasModeA && !UUID_RE.test(args.dispatch_id!)) {
      return badArg('dispatch_id', 'UUID inválido.');
    }

    const token = process.env.INTERNAL_AGENT_TOKEN;
    if (!token) {
      return {
        ok: false,
        error: 'INTERNAL_AGENT_TOKEN no configurada — pide al admin que la agregue.',
      };
    }

    const baseUrl = process.env.PLATFORM_INTERNAL_URL ?? 'http://localhost:3000';
    const url = `${baseUrl}/api/orchestrator/internal/propose-routes`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-internal-agent-token': token,
        },
        body: JSON.stringify({
          dispatch_id: args.dispatch_id,
          stop_ids: args.stop_ids,
          vehicle_ids: args.vehicle_ids,
          zone_id: args.zone_id,
          date: args.date,
          caller_user_id: ctx.userId,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Fetch falló.',
        recoverable: true,
      };
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({ error: 'sin detalle' }))) as {
        error?: string;
      };
      return { ok: false, error: errBody.error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as ProposeRoutePlanResult & { ok: boolean };
    const cheapest = data.alternatives.find((a) => a.labels.includes('cheapest'));

    const dispatchSuffix = data.dispatch?.id
      ? ` · Ver propuestas con map preview en /dispatches/${data.dispatch.id}/propose`
      : '';
    const cheapestSuffix = cheapest
      ? `Más económica: ${cheapest.vehicle_count} vehículo(s), ${cheapest.metrics.total_km} km, $${cheapest.cost.total_mxn.toLocaleString('es-MX')} MXN.`
      : '';
    const summary = cheapest
      ? `🎯 ${data.alternatives.length} alternativa(s) calculada(s). ${cheapestSuffix}${dispatchSuffix}`
      : `Calculé ${data.alternatives.length} opciones pero ninguna es factible con la jornada legal actual. Revisar constraints.`;

    return {
      ok: true,
      data,
      summary,
    };
  },
};

// ============================================================================
// apply_route_plan — Aplicar una alternativa de propose_route_plan (OE-3)
// ============================================================================

interface ApplyRoutePlanArgs {
  dispatch_id: string;
  vehicle_ids: string[];
  driver_ids?: Array<string | null>;
  /** cheapest / balanced / fastest — para audit. Opcional. */
  applied_label?: string;
}

interface ApplyRoutePlanResult {
  dispatch_id: string;
  applied_label?: string;
  new_route_ids: string[];
  total_distance_meters: number;
  total_duration_seconds: number;
  unassigned_store_ids: string[];
}

const apply_route_plan: ToolDefinition<ApplyRoutePlanArgs, ApplyRoutePlanResult> = {
  name: 'apply_route_plan',
  description:
    'Aplica una alternativa que el user eligió de `propose_route_plan`. Recibe `dispatch_id` + `vehicle_ids` (la lista exacta de vehículos de la opción elegida) + opcional `driver_ids` (alineados 1-a-1 con vehicle_ids; null = sin chofer). Re-estructura el tiro atómicamente: cancela rutas previas, crea nuevas con esos vehículos/choferes, vuelve a correr VROOM para asignar paradas óptimamente. Tarda 30-60s. Es DESTRUCTIVO con confirmación obligatoria. Solo funciona en pre-publicación (DRAFT/OPTIMIZED/APPROVED) — si hay rutas en curso, aborta con error claro.',
  is_write: true,
  requires_confirmation: true,
  input_schema: {
    type: 'object',
    properties: {
      dispatch_id: {
        type: 'string',
        format: 'uuid',
        description: 'UUID del tiro a re-estructurar.',
      },
      vehicle_ids: {
        type: 'array',
        items: { type: 'string', description: 'UUID del vehículo.' },
        description: 'Vehículos de la alternativa elegida. Mínimo 1.',
      },
      driver_ids: {
        type: 'array',
        items: { type: ['string', 'null'] as never, description: 'UUID del chofer o null.' },
        description:
          'Choferes alineados 1-a-1 con vehicle_ids. null = sin chofer asignado. Si omites, se aplica null a todos.',
      },
      applied_label: {
        type: 'string',
        description: 'Etiqueta de la alternativa elegida (cheapest, balanced, fastest, etc.) — para audit.',
      },
    },
    required: ['dispatch_id', 'vehicle_ids'],
  },
  handler: async (args, ctx): Promise<ToolResult<ApplyRoutePlanResult>> => {
    if (!UUID_RE.test(args.dispatch_id)) return badArg('dispatch_id', 'UUID inválido.');
    if (!Array.isArray(args.vehicle_ids) || args.vehicle_ids.length === 0) {
      return badArg('vehicle_ids', 'al menos 1 vehículo.');
    }
    for (const vid of args.vehicle_ids) {
      if (!UUID_RE.test(vid)) return badArg('vehicle_ids', `UUID inválido: ${vid}`);
    }

    const token = process.env.INTERNAL_AGENT_TOKEN;
    if (!token) return { ok: false, error: 'INTERNAL_AGENT_TOKEN no configurada.' };

    const baseUrl = process.env.PLATFORM_INTERNAL_URL ?? 'http://localhost:3000';
    const url = `${baseUrl}/api/orchestrator/internal/apply-plan`;

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-agent-token': token },
        body: JSON.stringify({
          dispatch_id: args.dispatch_id,
          vehicle_ids: args.vehicle_ids,
          driver_ids: args.driver_ids,
          applied_label: args.applied_label,
          caller_user_id: ctx.userId,
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'fetch falló',
        recoverable: true,
      };
    }

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as {
        error?: string;
      };
      return { ok: false, error: errBody.error ?? `HTTP ${res.status}` };
    }

    const data = (await res.json()) as ApplyRoutePlanResult & { ok: boolean };
    const summary = `✅ Plan aplicado. ${data.new_route_ids.length} ruta(s) nueva(s), ${(data.total_distance_meters / 1000).toFixed(0)} km, ${(data.total_duration_seconds / 3600).toFixed(1)} h manejo. ${data.unassigned_store_ids.length > 0 ? `⚠ ${data.unassigned_store_ids.length} tienda(s) sin asignar — revisar.` : ''}`;

    return { ok: true, data, summary };
  },
};

export const OPTIMIZE_TOOLS: ReadonlyArray<ToolDefinition> = [
  optimize_dispatch as unknown as ToolDefinition,
  propose_route_plan as unknown as ToolDefinition,
  apply_route_plan as unknown as ToolDefinition,
];
