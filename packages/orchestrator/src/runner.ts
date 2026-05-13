// Runner del orquestador: loop que llama Anthropic, ejecuta tool_use blocks,
// y emite eventos para que el endpoint SSE los streamee al cliente.
//
// 2.1.b: shell del runner sin tools (sólo prueba el roundtrip Anthropic).
// 2.1.c: integra TOOLS de lectura.
// 2.2: integra writes + confirmaciones.
// 2.5: integra quota check + audit completo.

import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompts/system';
import { getTool, listToolsForCustomer } from './tools/registry';
import { enrichPreviewForTool, type EnrichedPreview } from './previews';
import type { ToolContext, ToolDefinition, ToolResult } from './types';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const MAX_LOOP_ITERATIONS = 12; // Salvavidas contra loops infinitos.
const THINKING_BUDGET = 4000;

// Eventos que el runner emite via callback. El endpoint SSE los re-emite al
// cliente, persiste a BD según corresponda.
export type RunnerEvent =
  | { type: 'message_start'; sequence: number }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'text_delta'; delta: string }
  | {
      type: 'tool_use_start';
      tool_use_id: string;
      tool_name: string;
      args: Record<string, unknown>;
      requires_confirmation: boolean;
    }
  | { type: 'tool_use_result'; tool_use_id: string; result: ToolResult }
  | {
      type: 'confirmation_required';
      tool_use_id: string;
      tool_name: string;
      args: Record<string, unknown>;
      summary: string;
      preview: EnrichedPreview;
    }
  | {
      type: 'message_end';
      usage: {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      stop_reason: string;
    }
  | { type: 'loop_done'; iterations: number }
  | { type: 'error'; message: string };

export interface RunnerInput {
  /** Historial previo de la sesión (mensajes para reconstruir contexto). */
  history: Anthropic.MessageParam[];
  /**
   * Nuevo input del usuario (texto). Si está vacío y no hay confirmation,
   * el runner asume que `history` ya contiene el último input/tool_result y
   * solo invoca al modelo para continuar.
   */
  userMessage: string;
  /**
   * Legacy fallback (pre-2.2.b): pasar la confirmación al modelo via tool_result
   * "AWAITING_EXECUTION". Solo se usa si el endpoint no pudo ejecutar la
   * confirmation directamente (action pendiente no encontrada).
   */
  confirmation?: {
    tool_use_id: string;
    approved: boolean;
  };
  /** Rol del caller — restringe tools disponibles. */
  callerRole: 'admin' | 'dispatcher';
  /** Allowlist opcional del customer. */
  toolsAllowlist?: string[];
  /** Contexto que se pasa a cada tool handler. */
  toolContext: ToolContext;
  /** Callback para emitir eventos SSE. */
  emit: (event: RunnerEvent) => void | Promise<void>;
}

/**
 * Ejecuta el loop del agente para una vuelta de turno.
 * Termina cuando Claude responde con stop_reason='end_turn' o cuando una
 * tool requires_confirmation pausa el loop.
 */
export async function runOrchestrator(input: RunnerInput): Promise<{
  finalHistory: Anthropic.MessageParam[];
  pendingConfirmation: boolean;
}> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
  });

  // Tools disponibles para este caller.
  const availableTools = listToolsForCustomer(input.callerRole, input.toolsAllowlist);

  if (availableTools.length === 0) {
    await input.emit({
      type: 'error',
      message:
        'No hay herramientas disponibles para tu rol. Contacta a soporte si esto es inesperado.',
    });
    return { finalHistory: input.history, pendingConfirmation: false };
  }

  const toolsForApi = toolsToAnthropicFormat(availableTools);

  // Construir historial. Si hay confirmation, agregamos el tool_result que
  // refleja la decisión del usuario antes de pedirle a Claude que siga.
  const messages: Anthropic.MessageParam[] = [...input.history];
  if (input.confirmation) {
    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: input.confirmation.tool_use_id,
          content: input.confirmation.approved
            ? JSON.stringify({
                ok: false,
                error:
                  'AWAITING_EXECUTION: el usuario aprobó. Re-emite la herramienta para ejecutarla.',
              })
            : JSON.stringify({
                ok: false,
                error: 'REJECTED_BY_USER: el usuario rechazó esta acción.',
              }),
        },
      ],
    });
  } else if (input.userMessage && input.userMessage.length > 0) {
    messages.push({
      role: 'user',
      content: input.userMessage,
    });
  }
  // Si no hay userMessage ni confirmation, asumimos que history ya contiene
  // el último tool_result (flow 2.2.b post-confirmación ejecutada en server).
  // El modelo solo necesita continuar el turno.

  let iterations = 0;
  while (iterations < MAX_LOOP_ITERATIONS) {
    iterations++;
    await input.emit({ type: 'message_start', sequence: iterations });

    // 2.3.a: streaming real con .stream() — emite deltas token-by-token.
    // Acumulamos los content blocks finales para push al historial.
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: toolsForApi,
      messages,
    });

    // Suscribir a deltas y emitir SSE.
    stream.on('text', async (delta) => {
      await input.emit({ type: 'text_delta', delta });
    });
    stream.on('thinking', async (delta) => {
      await input.emit({ type: 'thinking_delta', delta });
    });

    const response = await stream.finalMessage();

    await input.emit({
      type: 'message_end',
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      },
      stop_reason: response.stop_reason ?? 'unknown',
    });

    // Push del assistant response al historial.
    messages.push({
      role: 'assistant',
      content: response.content,
    });

    // Si no hay tool_use → terminó el turno.
    if (response.stop_reason !== 'tool_use') {
      await input.emit({ type: 'loop_done', iterations });
      return { finalHistory: messages, pendingConfirmation: false };
    }

    // Procesar cada tool_use. Si alguna requires_confirmation y NO viene
    // pre-aprobada en input.confirmation, pausamos el loop.
    const toolResults: Anthropic.MessageParam = { role: 'user', content: [] };
    let pausedForConfirmation = false;

    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;

      const tool = getTool(block.name);
      if (!tool) {
        (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify({
            ok: false,
            error: `Tool '${block.name}' no existe. Tools disponibles: ${availableTools.map((t) => t.name).join(', ')}`,
          }),
          is_error: true,
        });
        continue;
      }

      // Si requires_confirmation, emitir confirmation_required y NO ejecutar.
      // Persistimos la action con status='pending_confirmation' para que el
      // endpoint /confirm la encuentre y ejecute directo (sin re-llamar al
      // modelo) cuando el user apruebe.
      if (tool.requires_confirmation) {
        try {
          await input.toolContext.supabase.from('orchestrator_actions').insert({
            customer_id: input.toolContext.customerId,
            session_id: input.toolContext.sessionId,
            user_id: input.toolContext.userId,
            tool_name: tool.name,
            is_write: tool.is_write,
            requires_confirmation: true,
            args: { ...(block.input as object), __tool_use_id: block.id } as never,
            status: 'pending_confirmation',
            result: null,
          });
        } catch {
          // Si el insert falla, emitimos la confirmación igual — el flujo
          // viejo (re-emit por el modelo) sirve como fallback degraded.
        }

        const enriched = await enrichPreviewForTool(
          tool.name,
          block.input as Record<string, unknown>,
          input.toolContext,
        );

        await input.emit({
          type: 'confirmation_required',
          tool_use_id: block.id,
          tool_name: tool.name,
          args: block.input as Record<string, unknown>,
          summary: enriched.headline,
          preview: enriched,
        });
        pausedForConfirmation = true;
        break; // No procesamos más tool_use blocks en este turno.
      }

      // Ejecutar tool.
      await input.emit({
        type: 'tool_use_start',
        tool_use_id: block.id,
        tool_name: tool.name,
        args: block.input as Record<string, unknown>,
        requires_confirmation: tool.requires_confirmation,
      });

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

      await input.emit({ type: 'tool_use_result', tool_use_id: block.id, result });

      // Audit: persistir cada tool_use en orchestrator_actions.
      // is_write determina si la action cuenta para el quota mensual.
      try {
        await input.toolContext.supabase.from('orchestrator_actions').insert({
          customer_id: input.toolContext.customerId,
          session_id: input.toolContext.sessionId,
          user_id: input.toolContext.userId,
          tool_name: tool.name,
          is_write: tool.is_write,
          requires_confirmation: tool.requires_confirmation,
          args: block.input as never,
          status: result.ok ? 'success' : 'error',
          result: result.ok ? ((result.data ?? null) as never) : null,
          error_message: result.ok ? null : result.error,
          duration_ms: durationMs,
        });
      } catch {
        // Audit failure NO debe romper el loop — la operación ya sucedió.
        // El próximo turn lo verá; el operador puede revisar logs.
      }

      (toolResults.content as Anthropic.ToolResultBlockParam[]).push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(result),
        is_error: !result.ok,
      });
    }

    if (pausedForConfirmation) {
      return { finalHistory: messages, pendingConfirmation: true };
    }

    messages.push(toolResults);
    // Loop continúa con los tool_results para que Claude decida el siguiente paso.
  }

  await input.emit({
    type: 'error',
    message: `Loop excedió ${MAX_LOOP_ITERATIONS} iteraciones — abortado por seguridad.`,
  });
  return { finalHistory: messages, pendingConfirmation: false };
}

function toolsToAnthropicFormat(tools: ReadonlyArray<ToolDefinition>): Anthropic.Tool[] {
  return tools.map((t, i) => {
    const apiTool: Anthropic.Tool = {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema as unknown as Anthropic.Tool['input_schema'],
    };
    // Cache control en el último tool → cachea system + tools juntos.
    if (i === tools.length - 1) {
      (apiTool as Anthropic.Tool & { cache_control?: { type: 'ephemeral' } }).cache_control = {
        type: 'ephemeral',
      };
    }
    return apiTool;
  });
}

/** Resumen humano para la UI de confirmación. Se enriquecerá en 2.2 con
 *  contexto del estado actual (ej. "Publicar tiro X afecta a 5 rutas, 23 paradas"). */
function summarizeForPreview(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): string {
  return `${tool.description}\n\nArgumentos:\n${JSON.stringify(args, null, 2)}`;
}
