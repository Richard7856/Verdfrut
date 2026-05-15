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

export const OPTIMIZE_TOOLS: ReadonlyArray<ToolDefinition> = [
  optimize_dispatch as unknown as ToolDefinition,
];
