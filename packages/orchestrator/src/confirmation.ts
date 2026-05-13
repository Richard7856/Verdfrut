// Helper para ejecutar una tool que estaba pendiente de confirmación.
//
// Flow correcto del runner con confirmaciones (2.2.b):
//   1. El modelo decide invocar una tool con requires_confirmation: true.
//   2. El runner persiste la action en orchestrator_actions con
//      status='pending_confirmation' + args + tool_use_id.
//   3. El runner pausa y emite evento confirmation_required al cliente.
//   4. El cliente muestra modal "¿Aprobar? sí/no".
//   5. Cliente llama POST /confirm con { tool_use_id, approved }.
//   6. El ENDPOINT busca la action pendiente con executeConfirmedTool(),
//      ejecuta la tool directamente, actualiza orchestrator_actions.
//   7. El endpoint inyecta el tool_result en el historial y reanuda el
//      runner con un nuevo turn (sin re-emitir tool_use por el modelo).
//
// Esto evita el desperdicio del flow legacy donde el modelo recibía
// "AWAITING_EXECUTION" y tenía que re-emitir el mismo tool_use (a veces
// no lo hacía bien).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@tripdrive/supabase';
import { getTool } from './tools/registry';
import type { ToolContext, ToolResult } from './types';

export interface ConfirmedToolExecution {
  toolUseId: string;
  toolName: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

/**
 * Look-up de la action pendiente + ejecución de la tool si aprobada.
 * Actualiza la fila de orchestrator_actions con el resultado final.
 *
 * Si approved=false → la action queda como 'rejected_by_user' y el tool_result
 * que retorna informa al modelo que el user rechazó.
 *
 * Si la action no existe (UUID inválido o ya ejecutada) → retorna error
 * recoverable para que el modelo intente otra cosa.
 */
export async function executeConfirmedTool(
  supabase: SupabaseClient<Database>,
  toolContext: ToolContext,
  toolUseId: string,
  approved: boolean,
): Promise<ConfirmedToolExecution | null> {
  // Buscar la action pendiente. Filtramos por session_id + status para
  // evitar que otro user "confirme" una pending ajena.
  const { data: pending, error: lookupErr } = await supabase
    .from('orchestrator_actions')
    .select('id, tool_name, args, customer_id, user_id')
    .eq('session_id', toolContext.sessionId)
    .eq('status', 'pending_confirmation')
    .order('created_at', { ascending: false })
    .limit(20);

  if (lookupErr || !pending) return null;

  // Match por __tool_use_id en args (inyectado por el runner cuando creó
  // la pending).
  const target = pending.find((p) => {
    const a = p.args as { __tool_use_id?: string } | null;
    return a?.__tool_use_id === toolUseId;
  });
  if (!target) return null;
  if (target.customer_id !== toolContext.customerId) return null;

  const argsClean = { ...(target.args as Record<string, unknown>) };
  delete (argsClean as Record<string, unknown>).__tool_use_id;

  // Si rechazada, solo actualizar status + retornar tool_result negativo.
  if (!approved) {
    await supabase
      .from('orchestrator_actions')
      .update({
        status: 'rejected_by_user',
        result: null,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', target.id);

    return {
      toolUseId,
      toolName: target.tool_name as string,
      args: argsClean,
      result: {
        ok: false,
        error: 'REJECTED_BY_USER: el usuario decidió no ejecutar esta acción.',
      },
    };
  }

  // Aprobada: ejecutar el handler.
  const tool = getTool(target.tool_name as string);
  if (!tool) {
    await supabase
      .from('orchestrator_actions')
      .update({
        status: 'error',
        error_message: `Tool '${target.tool_name}' ya no existe en el registro.`,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', target.id);
    return {
      toolUseId,
      toolName: target.tool_name as string,
      args: argsClean,
      result: { ok: false, error: `Tool '${target.tool_name}' no existe.` },
    };
  }

  const startedAt = Date.now();
  let result: ToolResult;
  try {
    result = await tool.handler(argsClean, toolContext);
  } catch (err) {
    result = {
      ok: false,
      error: err instanceof Error ? err.message : 'Excepción en handler.',
    };
  }
  const durationMs = Date.now() - startedAt;

  await supabase
    .from('orchestrator_actions')
    .update({
      status: result.ok ? 'success' : 'error',
      result: result.ok ? ((result.data ?? null) as never) : null,
      error_message: result.ok ? null : result.error,
      duration_ms: durationMs,
      confirmed_at: new Date().toISOString(),
    })
    .eq('id', target.id);

  return {
    toolUseId,
    toolName: target.tool_name as string,
    args: argsClean,
    result,
  };
}
