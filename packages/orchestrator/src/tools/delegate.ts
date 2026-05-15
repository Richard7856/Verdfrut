// Tools de delegación a sub-agentes especialistas (Stream R, Sprint R2+).
//
// El orchestrator invoca estas tools para entregar trabajo de dominio
// específico a un sub-agente con prompt focalizado y tool subset propio.
// El sub-agente corre en su propio loop y devuelve resultado estructurado.

import { runGeoAgent } from '../geo-runner';
import type { GeoAgentToolCall } from '../geo-runner';
import type { ToolDefinition, ToolResult } from '../types';

// ============================================================================
// delegate_to_geo
// ============================================================================

interface DelegateToGeoArgs {
  task: string;
  addresses?: string[];
  stop_ids?: string[];
  max_iterations?: number;
}

interface DelegateToGeoResult {
  summary: string;
  iterations_used: number;
  stop_reason: 'end_turn' | 'max_iterations' | 'error' | 'forbidden_tool';
  /** Tool calls que el sub-agente ejecutó. El orchestrator los lee para
   *  presentar resultados estructurados al user. */
  tool_calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    ok: boolean;
    data?: unknown;
    error?: string;
    duration_ms: number;
  }>;
  /** Métricas de costo del sub-loop (input/output/cache tokens). */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

const delegate_to_geo: ToolDefinition<DelegateToGeoArgs, DelegateToGeoResult> = {
  name: 'delegate_to_geo',
  description:
    'Delega tareas geográficas (geocodificación de direcciones, búsqueda Google Places, validación de coords de tiendas existentes, detección de duplicados) a un sub-agente especialista. Úsalo cuando el usuario te pida procesar 1+ direcciones, validar tiendas contra Google Maps, o resolver dudas de ubicación. El sub-agente es READ-ONLY: si el resultado sugiere crear/modificar registros, tú debes pedir confirmación al usuario y llamar la tool de write correspondiente (create_store, bulk_create_stores). No uses esta tool si el usuario ya te dio lat/lng exactos; en ese caso usa create_store directo.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description:
          'Descripción NATURAL en español de qué quieres que el geo agent haga. Sé específico: "geocodifica estas 30 direcciones y busca duplicados", "valida las coords de los stops X,Y,Z contra Google". Máximo ~500 caracteres.',
      },
      addresses: {
        type: 'array',
        items: { type: 'string', description: 'Una dirección postal completa' },
        description:
          'Lista de direcciones a procesar. Pasarlas aquí estructuradas es más eficiente que embeberlas en `task`. Cada dirección es una string completa (ej. "Av Reforma 222, CDMX").',
      },
      stop_ids: {
        type: 'array',
        items: { type: 'string', description: 'UUID de un stop existente' },
        description:
          'Lista opcional de IDs de tiendas en catálogo a validar/re-geocodificar contra Google.',
      },
      max_iterations: {
        type: 'integer',
        description:
          'Tope de iteraciones del sub-loop interno. Default 10. Aumenta solo si el batch es muy grande (>30 direcciones).',
      },
    },
    required: ['task'],
  },
  handler: async (args, ctx): Promise<ToolResult<DelegateToGeoResult>> => {
    // Validación liviana (defensa contra args mal formados).
    const task = (args.task ?? '').trim();
    if (task.length === 0) {
      return { ok: false, error: 'Argumento "task" no puede estar vacío.' };
    }
    if (task.length > 1000) {
      return {
        ok: false,
        error: 'Argumento "task" excede 1000 chars. Pasa direcciones en el array `addresses` en lugar de embeberlas en `task`.',
      };
    }

    const addresses = Array.isArray(args.addresses) ? args.addresses.filter((a) => typeof a === 'string') : [];
    const stopIds = Array.isArray(args.stop_ids) ? args.stop_ids.filter((s) => typeof s === 'string') : [];

    // Cap defensivo: el geo agent es batch-worker pero no infinito. Si llegan
    // >100 direcciones, el orchestrator debería partirlas en chunks. Limit
    // razonable: 50 por delegación.
    if (addresses.length > 50) {
      return {
        ok: false,
        error: `Batch excede 50 direcciones (recibí ${addresses.length}). Divide la operación en varias llamadas a delegate_to_geo.`,
      };
    }
    if (stopIds.length > 50) {
      return {
        ok: false,
        error: `Batch excede 50 stop_ids (recibí ${stopIds.length}). Divide la operación en varias llamadas a delegate_to_geo.`,
      };
    }

    const maxIter = args.max_iterations;
    if (maxIter !== undefined && (typeof maxIter !== 'number' || maxIter < 1 || maxIter > 25)) {
      return { ok: false, error: 'max_iterations debe estar entre 1 y 25.' };
    }

    // Ejecutar sub-agente.
    const output = await runGeoAgent({
      task,
      addresses: addresses.length > 0 ? addresses : undefined,
      stopIds: stopIds.length > 0 ? stopIds : undefined,
      maxIterations: maxIter,
      toolContext: ctx,
      parentSessionId: ctx.sessionId,
    });

    // Mapear toolCalls del shape interno (incluye ToolResult completo) a la
    // versión plana que va al orchestrator. is_error implícito en `ok`.
    const flatToolCalls = output.toolCalls.map((tc: GeoAgentToolCall) => ({
      tool: tc.toolName,
      args: tc.args,
      ok: tc.result.ok,
      data: tc.result.ok ? tc.result.data : undefined,
      error: tc.result.ok ? undefined : tc.result.error,
      duration_ms: tc.durationMs,
    }));

    // Siempre ok:true desde la perspectiva del orchestrator. El éxito real
    // de la delegación lo refleja `stop_reason` en data — el orchestrator
    // lee ese campo para decidir si reportar fallo al user. Esto preserva
    // los tool_calls intentados aún cuando hubo error interno del sub-loop.
    return {
      ok: true,
      data: {
        summary: output.summary,
        iterations_used: output.iterationsUsed,
        stop_reason: output.stopReason,
        tool_calls: flatToolCalls,
        usage: output.usage,
      },
      summary: output.summary,
    };
  },
};

// ============================================================================
// enter_router_mode — handoff conversacional al router agent (Sprint R3)
// ============================================================================

interface EnterRouterModeArgs {
  reason: string;
}

interface EnterRouterModeResult {
  active_agent_role: 'router';
  hint_for_user: string;
}

const enter_router_mode: ToolDefinition<EnterRouterModeArgs, EnterRouterModeResult> = {
  name: 'enter_router_mode',
  description:
    'Entrega el control conversacional al ROUTER agent (especialista en armado/optimización de rutas). Úsalo cuando el usuario pida: armar un tiro, optimizar rutas, mover/reasignar paradas, ver alternativas de ruteo, comparar planes. El router toma la conversación con un system prompt más rico (capas 1-4 del Optimization Engine, costos MXN, jornada legal) hasta que devuelva el control con `exit_router_mode`. NO uses esta tool si el user solo necesita ver tiros listados o info pasiva — eso lo manejas tú directo.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        description:
          'Resumen breve (1 línea) de por qué estás entregando el control. Ej: "user pidió armar tiro CDMX lunes" o "comparar 2 vs 3 camionetas en zona Sur". Va al historial para audit.',
      },
    },
    required: ['reason'],
  },
  handler: async (args, ctx): Promise<ToolResult<EnterRouterModeResult>> => {
    const reason = (args.reason ?? '').trim();
    if (reason.length === 0) {
      return { ok: false, error: 'Argumento "reason" es requerido (1 línea explicando el handoff).' };
    }

    // Marcar la sesión como "modo router". Mismo customer_id (RLS lo
    // protege también). El próximo turno del user activará al router.
    const { error } = await ctx.supabase
      .from('orchestrator_sessions')
      .update({ active_agent_role: 'router' } as never)
      .eq('id', ctx.sessionId)
      .eq('customer_id', ctx.customerId);

    if (error) {
      return {
        ok: false,
        error: `No se pudo activar modo router: ${error.message}. ¿Migración 046 aplicada?`,
      };
    }

    return {
      ok: true,
      data: {
        active_agent_role: 'router',
        hint_for_user:
          'Modo routing activado. El especialista en rutas tomará la conversación a partir de tu próximo mensaje.',
      },
      summary: `Modo router activado: ${reason}`,
    };
  },
};

// ============================================================================
// exit_router_mode — devuelve control al orchestrator (vive en rol router)
// ============================================================================

interface ExitRouterModeArgs {
  outcome: string;
}

interface ExitRouterModeResult {
  active_agent_role: 'orchestrator';
}

const exit_router_mode: ToolDefinition<ExitRouterModeArgs, ExitRouterModeResult> = {
  name: 'exit_router_mode',
  description:
    'Devuelve el control conversacional al ORCHESTRATOR. Úsalo cuando: (1) terminaste la operación de routing (tiro publicado/cancelado/abandonado), (2) el user pivota a un tema fuera de routing, (3) el user explícitamente pide "regresar al chat normal" o similar. Pasa un `outcome` breve para que el orchestrator tenga contexto.',
  is_write: false,
  requires_confirmation: false,
  input_schema: {
    type: 'object',
    properties: {
      outcome: {
        type: 'string',
        description:
          'Resumen breve (1-2 líneas) del resultado de la operación de routing. Ej: "tiro CDMX Lunes 18 publicado con 2 rutas, 21 paradas". Va al historial.',
      },
    },
    required: ['outcome'],
  },
  handler: async (args, ctx): Promise<ToolResult<ExitRouterModeResult>> => {
    const outcome = (args.outcome ?? '').trim();
    if (outcome.length === 0) {
      return { ok: false, error: 'Argumento "outcome" es requerido.' };
    }

    const { error } = await ctx.supabase
      .from('orchestrator_sessions')
      .update({ active_agent_role: 'orchestrator' } as never)
      .eq('id', ctx.sessionId)
      .eq('customer_id', ctx.customerId);

    if (error) {
      return {
        ok: false,
        error: `No se pudo desactivar modo router: ${error.message}. ¿Migración 046 aplicada?`,
      };
    }

    return {
      ok: true,
      data: { active_agent_role: 'orchestrator' },
      summary: `Modo router cerrado: ${outcome}`,
    };
  },
};

// Cast a ToolDefinition genérico (los args son contravariantes, mismo patrón
// que PLACES_TOOLS). El runtime es exactamente el mismo objeto.
export const DELEGATE_TOOLS: ReadonlyArray<ToolDefinition> = [
  delegate_to_geo as unknown as ToolDefinition,
  enter_router_mode as unknown as ToolDefinition,
  exit_router_mode as unknown as ToolDefinition,
];
