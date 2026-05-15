// Endpoint del orquestador AI — POST con streaming SSE.
//
// Recibe: { sessionId?, message, confirmation? }
//   - Si !sessionId → crea nueva sesión.
//   - Si confirmation → resume loop con la decisión del usuario.
//   - Si message → user input nuevo.
//
// Streamea eventos del runner directo al cliente. Al terminar, persiste el
// turno completo a orchestrator_messages + agrega contadores agregados.

import 'server-only';
import { requireAdminOrDispatcher } from '@/lib/auth';
import { createServerClient, createServiceRoleClient } from '@tripdrive/supabase/server';
import {
  runOrchestrator,
  executeConfirmedTool,
  type RunnerEvent,
  type ToolContext,
  type AnthropicMessageParam,
} from '@tripdrive/orchestrator';
import { hasFeature, PLAN_LABELS } from '@tripdrive/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatPayload {
  sessionId?: string;
  message?: string;
  confirmation?: {
    tool_use_id: string;
    approved: boolean;
  };
}

export async function POST(req: Request) {
  const profile = await requireAdminOrDispatcher();

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY no configurada en el servidor.' },
      { status: 503 },
    );
  }

  let payload: ChatPayload;
  try {
    payload = (await req.json()) as ChatPayload;
  } catch {
    return Response.json({ error: 'Body inválido.' }, { status: 400 });
  }

  if (!payload.message && !payload.confirmation) {
    return Response.json(
      { error: 'Debe incluir `message` o `confirmation`.' },
      { status: 400 },
    );
  }

  // Sesión: usa la del request (RLS validará dueño) para reads y la admin para writes.
  const sessionClient = await createServerClient();
  const admin = createServiceRoleClient();

  // Resolver customer_id + timezone + tier/status/overrides para gate.
  // ADR-095: el asistente AI requiere `ai` habilitado. Es la decisión
  // de gate más importante porque cada turn cuesta tokens — sin gate,
  // un Operación consume Claude API sin pagar el delta.
  const { data: callerProfile } = await sessionClient
    .from('user_profiles')
    .select(
      'customer_id, customers:customer_id ( timezone, tier, status, feature_overrides )',
    )
    .eq('id', profile.id)
    .single();

  const callerRow = callerProfile as unknown as {
    customer_id: string;
    customers: {
      timezone: string;
      tier: 'starter' | 'pro' | 'enterprise';
      status: 'active' | 'demo' | 'paused' | 'churned';
      feature_overrides: unknown;
    } | null;
  } | null;
  if (!callerRow?.customer_id || !callerRow.customers) {
    return Response.json(
      { error: 'No se pudo resolver el customer del usuario.' },
      { status: 500 },
    );
  }

  // Gate del asistente AI por plan.
  const aiAllowed = hasFeature(
    {
      tier: callerRow.customers.tier,
      status: callerRow.customers.status,
      feature_overrides: callerRow.customers.feature_overrides,
    },
    'ai',
  );
  if (!aiAllowed) {
    return Response.json(
      {
        error:
          `El asistente AI no está incluido en el plan ${PLAN_LABELS[callerRow.customers.tier]} de tu organización. ` +
          'Habla con TripDrive para activarlo o subir a Pro.',
        code: 'feature_not_available',
        feature: 'ai',
      },
      { status: 403 },
    );
  }

  const customerId = callerRow.customer_id;
  const timezone = callerRow.customers?.timezone ?? 'America/Mexico_City';

  // Resolver / crear sesión.
  let sessionId = payload.sessionId;
  if (!sessionId) {
    const { data: newSession, error: insErr } = await sessionClient
      .from('orchestrator_sessions')
      .insert({
        user_id: profile.id,
        title: payload.message?.slice(0, 80) ?? 'Nueva conversación',
      })
      .select('id')
      .single();
    if (insErr || !newSession) {
      return Response.json(
        { error: `No se pudo crear la sesión: ${insErr?.message ?? 'desconocido'}` },
        { status: 500 },
      );
    }
    sessionId = newSession.id as string;
  } else {
    // Validar ownership.
    const { data: existing } = await sessionClient
      .from('orchestrator_sessions')
      .select('id, user_id, state')
      .eq('id', sessionId)
      .maybeSingle();
    if (!existing) {
      return Response.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    }
    if (existing.state !== 'open') {
      return Response.json({ error: 'Sesión cerrada o archivada.' }, { status: 409 });
    }
  }

  // Stream R / Sprint R3 (ADR-101): leer active_agent_role de la sesión.
  // Defensa: si la migración 046 no está aplicada, el SELECT falla con
  // 42703 (column does not exist) y caemos a 'orchestrator' (default
  // pre-R3). Sesiones legacy también dan 'orchestrator' por DB DEFAULT.
  let initialRole: 'orchestrator' | 'geo' | 'router' = 'orchestrator';
  {
    const { data: sessionRole, error: roleErr } = await admin
      .from('orchestrator_sessions')
      .select('active_agent_role' as never)
      .eq('id', sessionId)
      .maybeSingle();
    if (!roleErr && sessionRole) {
      const r = (sessionRole as { active_agent_role?: unknown }).active_agent_role;
      if (r === 'router' || r === 'geo' || r === 'orchestrator') {
        initialRole = r;
      }
    }
    // Si roleErr, fallback silencioso a 'orchestrator' (migración pendiente).
  }

  // Cargar historial de mensajes para reconstruir contexto de Anthropic.
  // Las filas en orchestrator_messages tienen `content` JSONB con el shape
  // del API de Anthropic (text, tool_use, tool_result blocks).
  const { data: priorMessages } = await admin
    .from('orchestrator_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('sequence', { ascending: true });

  const history: AnthropicMessageParam[] = ((priorMessages ?? []) as Array<{
    role: 'user' | 'assistant' | 'tool_result' | 'system_note';
    content: unknown;
  }>)
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool_result')
    .map((m) => ({
      role: m.role === 'tool_result' ? 'user' : (m.role as 'user' | 'assistant'),
      content: m.content as AnthropicMessageParam['content'],
    }));

  // SSE encoder.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = async (event: RunnerEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Anuncia sessionId al cliente antes de empezar el loop.
      await emit({
        type: 'message_start',
        sequence: 0,
      });
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: 'session', sessionId })}\n\n`),
      );

      const toolContext: ToolContext = {
        customerId,
        userId: profile.id,
        sessionId: sessionId as string,
        supabase: admin,
        timezone,
      };

      try {
        // Flow de confirmación 2.2.b: si viene confirmation, ejecutar la
        // tool pendiente DIRECTAMENTE en el server (sin re-emitir tool_use
        // por el modelo). Inyectamos el tool_result al historial y dejamos
        // que el modelo continúe el turno con el resultado real.
        let workingHistory: AnthropicMessageParam[] = [...history];
        let confirmationForRunner: typeof payload.confirmation | undefined;

        if (payload.confirmation) {
          const exec = await executeConfirmedTool(
            admin,
            toolContext,
            payload.confirmation.tool_use_id,
            payload.confirmation.approved,
          );

          if (!exec) {
            // No se encontró la action pendiente — fallback al flow legacy
            // que delega al modelo decidir.
            confirmationForRunner = payload.confirmation;
          } else {
            // Emitir el resultado para que la UI lo muestre.
            await emit({
              type: 'tool_use_result',
              tool_use_id: exec.toolUseId,
              result: exec.result,
            });

            // Inyectar tool_result al historial.
            workingHistory.push({
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: exec.toolUseId,
                  content: JSON.stringify(exec.result),
                  is_error: !exec.result.ok,
                },
              ],
            });
          }
        }

        // Anuncia el rol activo al cliente para que la UI muestre el badge
        // ("modo routing", "modo orchestrator", etc.) ANTES de empezar el loop.
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'active_role', role: initialRole })}\n\n`,
          ),
        );

        const { finalHistory, pendingConfirmation } = await runOrchestrator({
          // Stream R: el rol viene del estado de la sesión (orchestrator_sessions
          // .active_agent_role). Las tools `enter_router_mode` / `exit_router_mode`
          // actualizan ese estado durante el turno; al final del turno releemos
          // el rol y emitimos un evento si cambió.
          role: initialRole,
          history: workingHistory,
          userMessage:
            payload.confirmation && !confirmationForRunner ? '' : payload.message ?? '',
          confirmation: confirmationForRunner,
          callerRole: profile.role as 'admin' | 'dispatcher',
          toolContext,
          emit,
        });

        // R3: detectar si el rol cambió durante el turno (alguna tool llamó
        // a enter_/exit_router_mode) y notificar al cliente. Defensa: si la
        // migración 046 no está, el SELECT falla y no emitimos transición.
        try {
          const { data: postRole } = await admin
            .from('orchestrator_sessions')
            .select('active_agent_role' as never)
            .eq('id', sessionId)
            .maybeSingle();
          const newRole = (postRole as { active_agent_role?: unknown } | null)?.active_agent_role;
          if (
            (newRole === 'orchestrator' || newRole === 'router' || newRole === 'geo') &&
            newRole !== initialRole
          ) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'role_changed',
                  from: initialRole,
                  to: newRole,
                })}\n\n`,
              ),
            );
          }
        } catch {
          // Migración 046 no aplicada o falla — silencioso, no es bloqueante.
        }

        // Persistir mensajes nuevos del turno a BD.
        // Solo escribimos los que NO estaban en el historial original
        // (finalHistory tiene history + nuevos).
        const startIdx = history.length;
        const newMessages = finalHistory.slice(startIdx);

        const lastSeqResult = await admin
          .from('orchestrator_messages')
          .select('sequence')
          .eq('session_id', sessionId)
          .order('sequence', { ascending: false })
          .limit(1);
        const lastSeq = (lastSeqResult.data?.[0]?.sequence as number | undefined) ?? -1;

        for (let i = 0; i < newMessages.length; i++) {
          const msg = newMessages[i]!;
          const role: 'user' | 'assistant' | 'tool_result' =
            msg.role === 'user'
              ? // Si el content del user message tiene tool_result blocks, marcarlo como tool_result.
                Array.isArray(msg.content) &&
                msg.content.some((c) => typeof c === 'object' && c.type === 'tool_result')
                ? 'tool_result'
                : 'user'
              : 'assistant';

          await admin.from('orchestrator_messages').insert({
            customer_id: customerId,
            session_id: sessionId,
            sequence: lastSeq + 1 + i,
            role,
            content: msg.content as unknown as never,
          });
        }

        // Actualizar last_message_at + state si quedó pendiente confirmación.
        await admin
          .from('orchestrator_sessions')
          .update({
            last_message_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionId);

        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({ type: 'done', pendingConfirmation })}\n\n`,
          ),
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Error desconocido';
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
