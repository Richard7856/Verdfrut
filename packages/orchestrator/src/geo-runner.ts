// Sub-runner del agente GEO (Stream R / Sprint R2, ROADMAP 2026-05-15).
//
// Diferencias clave vs runOrchestrator:
//   - NO emite eventos SSE al user (corre silencioso dentro de delegate_to_geo).
//   - NO maneja pausas por requires_confirmation — el geo agent es read-only
//     por diseño (TOOLS_BY_ROLE.geo no incluye writes), así que en teoría
//     ningún tool puede pedirla. Defensivamente, si alguno aparece, lo
//     interpretamos como error y abortamos.
//   - NO persiste historial conversacional — cada delegación es stateless.
//   - SÍ persiste audit en orchestrator_actions con flag delegated_from
//     para trazabilidad (saber qué session/turn del orchestrator originó
//     cada tool call interno).
//   - Tope de iteraciones más agresivo (default 10 vs 12).
//
// Output: { summary, toolCalls, iterationsUsed, stopReason }. El orchestrator
// usa toolCalls como fuente de datos estructurados y summary como texto humano.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPTS } from './prompts';
import { getTool } from './tools/registry';
import { getRoleToolNames } from './tools/role-mapping';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const MODEL = process.env.GEO_AGENT_MODEL ?? process.env.ORCHESTRATOR_MODEL ?? 'claude-sonnet-4-6';
const MAX_TOKENS = 4096; // El geo agent no necesita responder largo.
const DEFAULT_MAX_ITERATIONS = 10;

// Geo es batch-worker — no necesita extended thinking. Es deterministic-ish.
// Si en producción vemos calidad baja, activar thinking aquí también.
const SUPPORTS_THINKING = false;

export interface GeoAgentInput {
  /** Descripción natural de la tarea (proviene del arg `task` de delegate_to_geo). */
  task: string;
  /** Direcciones a procesar (opcional — pueden venir embebidas en `task`). */
  addresses?: readonly string[];
  /** IDs de stops del catálogo a validar (opcional). */
  stopIds?: readonly string[];
  /** Tope de iteraciones del loop interno (default 10). */
  maxIterations?: number;
  /** Contexto compartido con el orchestrator (customer, supabase, etc.). */
  toolContext: ToolContext;
  /**
   * sessionId del orchestrator que originó la delegación. Se persiste en
   * orchestrator_actions.delegated_from para trazabilidad.
   */
  parentSessionId: string;
}

export interface GeoAgentToolCall {
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  durationMs: number;
}

export interface GeoAgentOutput {
  /** Texto natural del último mensaje del geo agent (resumen para el orchestrator). */
  summary: string;
  /** Tool calls ejecutados — fuente de datos estructurados. */
  toolCalls: GeoAgentToolCall[];
  iterationsUsed: number;
  stopReason: 'end_turn' | 'max_iterations' | 'error' | 'forbidden_tool';
  /** Tokens consumidos por el sub-loop (para auditoría de costo). */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
}

/**
 * Corre el sub-loop del geo agent hasta que termina o alcanza el tope de
 * iteraciones. NO lanza excepciones — los errores van empaquetados en el
 * resultado para que delegate_to_geo los pueda reportar al orchestrator.
 */
export async function runGeoAgent(input: GeoAgentInput): Promise<GeoAgentOutput> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  });

  const maxIterations = input.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const allowedToolNames = new Set(getRoleToolNames('geo'));
  const toolsForApi = buildToolsForApi(allowedToolNames);

  if (toolsForApi.length === 0) {
    return {
      summary: 'ERROR: el geo agent no tiene tools asignadas (TOOLS_BY_ROLE.geo vacío).',
      toolCalls: [],
      iterationsUsed: 0,
      stopReason: 'error',
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
  }

  // Construir el user message inicial. Embebemos addresses/stopIds como bloque
  // estructurado para que el modelo no tenga que parsearlos del task string.
  const initialUserMessage = buildInitialUserMessage(input);

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: initialUserMessage },
  ];

  const toolCalls: GeoAgentToolCall[] = [];
  let iterationsUsed = 0;
  let stopReason: GeoAgentOutput['stopReason'] = 'end_turn';
  const usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  let lastAssistantText = '';

  while (iterationsUsed < maxIterations) {
    iterationsUsed++;

    const streamParams: Anthropic.MessageStreamParams = {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPTS.geo,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: toolsForApi,
      messages,
    };
    if (SUPPORTS_THINKING) {
      streamParams.thinking = { type: 'enabled', budget_tokens: 2000 };
    }

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.stream(streamParams).finalMessage();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Anthropic API call falló';
      return {
        summary: `ERROR del geo agent: ${msg}`,
        toolCalls,
        iterationsUsed,
        stopReason: 'error',
        usage,
      };
    }

    usage.input_tokens += response.usage.input_tokens;
    usage.output_tokens += response.usage.output_tokens;
    usage.cache_creation_input_tokens += response.usage.cache_creation_input_tokens ?? 0;
    usage.cache_read_input_tokens += response.usage.cache_read_input_tokens ?? 0;

    // Push assistant message al historial interno.
    messages.push({ role: 'assistant', content: response.content });

    // Extraer texto del mensaje (para summary final).
    for (const block of response.content) {
      if (block.type === 'text') lastAssistantText = block.text;
    }

    if (response.stop_reason !== 'tool_use') {
      // El agente terminó.
      stopReason = 'end_turn';
      break;
    }

    // Procesar tool_use blocks.
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    let forbiddenToolDetected = false;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      // Defensa: el modelo solo debería tener acceso a las tools del rol
      // geo, pero si Anthropic devuelve un tool_use que no está en el
      // allowlist, lo rechazamos en duro.
      if (!allowedToolNames.has(block.name)) {
        forbiddenToolDetected = true;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            ok: false,
            error: `Tool '${block.name}' no autorizado para el geo agent. Lista válida: ${[...allowedToolNames].join(', ')}.`,
          }),
          is_error: true,
        });
        continue;
      }

      const tool = getTool(block.name);
      if (!tool) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({ ok: false, error: `Tool '${block.name}' no existe en el registry.` }),
          is_error: true,
        });
        continue;
      }

      // Defensa adicional: si por accidente un tool con requires_confirmation
      // se asignó al rol geo, lo rechazamos. El geo agent no soporta pausa.
      if (tool.requires_confirmation) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            ok: false,
            error: `Tool '${block.name}' requiere confirmación y no puede ejecutarse desde geo agent. Reporta esto al orchestrator.`,
          }),
          is_error: true,
        });
        continue;
      }

      // Ejecutar el tool.
      const startedAt = Date.now();
      let result: ToolResult;
      try {
        result = await tool.handler(block.input as Record<string, unknown>, input.toolContext);
      } catch (err) {
        result = {
          ok: false,
          error: err instanceof Error ? err.message : 'Tool handler lanzó excepción',
        };
      }
      const durationMs = Date.now() - startedAt;

      toolCalls.push({
        toolName: tool.name,
        args: block.input as Record<string, unknown>,
        result,
        durationMs,
      });

      // Audit: persistir cada tool call con delegated_from para trazabilidad.
      // Si la tabla no tiene la columna delegated_from (migración pendiente),
      // el insert falla silenciosamente — el ADR-099 / R2 documenta que esta
      // columna se agrega en una migración separada (no bloqueante).
      try {
        await input.toolContext.supabase.from('orchestrator_actions').insert({
          customer_id: input.toolContext.customerId,
          session_id: input.toolContext.sessionId,
          user_id: input.toolContext.userId,
          tool_name: tool.name,
          is_write: tool.is_write,
          requires_confirmation: false,
          args: block.input as never,
          status: result.ok ? 'success' : 'error',
          result: result.ok ? ((result.data ?? null) as never) : null,
          error_message: result.ok ? null : result.error,
          duration_ms: durationMs,
        });
      } catch {
        // Audit failure NO debe romper el sub-loop.
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    // Push tool_results para que el modelo decida el siguiente paso.
    messages.push({ role: 'user', content: toolResults });

    if (forbiddenToolDetected) {
      stopReason = 'forbidden_tool';
      // No abortamos inmediatamente — dejamos que el modelo lea el error
      // y produzca un summary en la próxima iteración. Pero marcamos el
      // stopReason por si excede el max.
    }
  }

  if (iterationsUsed >= maxIterations && stopReason === 'end_turn') {
    // Si salimos por max sin que el modelo cerrara naturalmente, marcamos.
    stopReason = 'max_iterations';
  }

  return {
    summary: lastAssistantText || '(sin resumen — el geo agent no produjo texto final)',
    toolCalls,
    iterationsUsed,
    stopReason,
    usage,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────

function buildToolsForApi(allowedNames: Set<string>): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  for (const name of allowedNames) {
    const tool = getTool(name);
    if (!tool) continue;
    tools.push({
      name: tool.name,
      description: tool.description,
      input_schema: tool.input_schema as unknown as Anthropic.Tool['input_schema'],
    });
  }
  // Cache control en el último para que system+tools cacheen juntos.
  const last = tools[tools.length - 1];
  if (last) {
    (last as Anthropic.Tool & { cache_control?: { type: 'ephemeral' } }).cache_control = {
      type: 'ephemeral',
    };
  }
  return tools;
}

function buildInitialUserMessage(input: GeoAgentInput): string {
  const parts: string[] = [];
  parts.push(`TAREA: ${input.task}`);

  if (input.addresses && input.addresses.length > 0) {
    parts.push('');
    parts.push(`DIRECCIONES A PROCESAR (${input.addresses.length}):`);
    input.addresses.forEach((addr, i) => parts.push(`  ${i + 1}. ${addr}`));
  }

  if (input.stopIds && input.stopIds.length > 0) {
    parts.push('');
    parts.push(`STOP_IDS A VALIDAR (${input.stopIds.length}):`);
    input.stopIds.forEach((id, i) => parts.push(`  ${i + 1}. ${id}`));
  }

  parts.push('');
  parts.push(
    `CONTEXTO: corres como sub-agente del orchestrator. customer_id=${input.toolContext.customerId} (RLS ya filtra). Origen: orchestrator session ${input.parentSessionId}.`,
  );

  return parts.join('\n');
}

// Exportada para tests — permite construir el mensaje sin llamar la API.
export { buildInitialUserMessage as _buildInitialUserMessageForTesting };
