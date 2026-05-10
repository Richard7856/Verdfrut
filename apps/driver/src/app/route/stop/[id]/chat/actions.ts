'use server';

// Server actions del chat (lado driver).
// Las llamadas pasan por el outbox (ADR-021 / send_chat_message), pero exponemos
// también los actions raw para que el handler las ejecute.
//
// Reglas de RLS (migración 018):
//  - sender = 'driver' AND current_user_role() = 'driver'
//  - sender_user_id = auth.uid()
// Por tanto el chofer no puede mentir sobre su rol.
//
// AI mediator (S18.8 / migración 027):
// Tras insertar el mensaje del chofer (con texto), invocamos classifyDriverMessage.
// - 'trivial' → AI inserta auto-reply como sender='system' y NO dispara push.
// - 'real_problem' / 'unknown' → push fanout normal (admin + dispatcher + zone_manager).
// Cada decisión queda en chat_ai_decisions para auditar y calibrar.

import { createServerClient, createServiceRoleClient } from '@verdfrut/supabase/server';
import { logger } from '@verdfrut/observability';
import { sendChatPushToZoneManagers } from '@/lib/push-fanout';
import { consume, LIMITS } from '@/lib/rate-limit';
import { classifyDriverMessage } from '@verdfrut/ai';

const MAX_CHAT_TEXT = 2_000; // Mismo cap que el composer — defensa server-side.

export interface ActionOk {
  ok: true;
  data?: { id: string };
}
export interface ActionErr {
  ok: false;
  error: string;
}
export type Result = ActionOk | ActionErr;

/**
 * Inserta un mensaje del chofer.
 * El trigger `tg_messages_open_chat` setea `chat_opened_at`/`timeout_at` la
 * primera vez. Tras el insert, si era el primer mensaje, disparamos push al
 * zone_manager de la zona.
 */
export async function sendDriverMessage(
  reportId: string,
  body: { text?: string | null; imageUrl?: string | null },
): Promise<Result> {
  if (!body.text && !body.imageUrl) {
    return { ok: false, error: 'El mensaje debe tener texto o imagen.' };
  }
  if (body.text && body.text.length > MAX_CHAT_TEXT) {
    return { ok: false, error: `Mensaje demasiado largo (máx ${MAX_CHAT_TEXT} caracteres).` };
  }
  const supabase = await createServerClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: 'Sesión inválida' };
  }
  // Rate limit anti-spam (ADR-023 / #41).
  if (!consume(userData.user.id, 'chat', LIMITS.chatDriverMessage)) {
    return { ok: false, error: 'Estás enviando mensajes muy rápido. Espera un momento.' };
  }

  // Antes del insert: ¿es el primer mensaje? Lo necesitamos para decidir push.
  // (No usamos eq('chat_opened_at', null) porque jsonb null es sticky; usamos is.)
  const { data: reportRow } = await supabase
    .from('delivery_reports')
    .select('chat_opened_at, zone_id')
    .eq('id', reportId)
    .maybeSingle();
  const isFirstMessage = reportRow?.chat_opened_at == null;
  const zoneId = reportRow?.zone_id ?? null;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      report_id: reportId,
      sender: 'driver',
      sender_user_id: userData.user.id,
      text: body.text ?? null,
      image_url: body.imageUrl ?? null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo enviar el mensaje' };
  }

  // AI mediator (S18.8) — solo aplica cuando hay texto. Si es solo imagen, escalamos siempre.
  // El proceso: clasifica → si trivial inserta auto-reply, si no escala con push.
  // Todo en background — no bloquea la respuesta al chofer.
  //
  // P1-2: la cadena de escalado tiene 2 capas de fire-and-forget. Si el push
  // falla, antes solo se logueaba — el zone_manager NO se enteraba del chat.
  // Ahora envolvemos la escalada en un await interno con doble try, y si la
  // entrega falla, persistimos audit en `chat_ai_decisions` para que un cron
  // o pantalla operativa pueda re-enviar manualmente. Sigue siendo
  // fire-and-forget al caller (no bloquea la respuesta del chofer).
  const triggeringMessageId = data.id;
  if (body.text && body.text.trim().length > 0) {
    void (async () => {
      try {
        await mediateChatMessage({
          reportId,
          messageId: triggeringMessageId,
          driverText: body.text!,
          isFirstMessage,
          zoneId,
        });
      } catch (err) {
        await logger.error('chat.mediator falló — escalando manualmente', {
          reportId, messageId: triggeringMessageId, err,
        });
        if (isFirstMessage && zoneId) {
          try {
            await sendChatPushToZoneManagers({ reportId, zoneId });
          } catch (pushErr) {
            await persistEscalationFailure(reportId, triggeringMessageId, body.text!, pushErr);
          }
        }
      }
    })();
  } else if (isFirstMessage && zoneId) {
    // Solo imagen sin texto → escalar siempre.
    void (async () => {
      try {
        await sendChatPushToZoneManagers({ reportId, zoneId });
      } catch (e) {
        await persistEscalationFailure(reportId, triggeringMessageId, '[imagen]', e);
      }
    })();
  }

  return { ok: true, data: { id: data.id } };
}

/**
 * P1-2: persiste un fallo de escalación de push para que un proceso humano o
 * un cron pueda re-enviarlo. Hoy se loguea + se inserta una fila en
 * `chat_ai_decisions` con category='escalation_push_failed' para que aparezca
 * en cualquier audit dashboard del mediator. Si la inserción también falla,
 * el último recurso es console.error — pero al menos no perdemos en silencio
 * en el 99% de los casos.
 */
async function persistEscalationFailure(
  reportId: string,
  triggeringMessageId: string,
  driverText: string,
  err: unknown,
): Promise<void> {
  const msg = err instanceof Error ? err.message : String(err);
  await logger.error('chat.escalation push falló', {
    reportId, messageId: triggeringMessageId, err,
  });
  try {
    const { createServiceRoleClient } = await import('@verdfrut/supabase/server');
    const admin = createServiceRoleClient();
    // El enum `category` actual es trivial|real_problem|unknown. Marcamos como
    // unknown con prefix claro en `rationale` para que la pantalla de audit
    // (futura) pueda filtrar por "ESCALATION_PUSH_FAILED:". Cuando justifique,
    // ampliar el enum con un valor dedicado (migración + ADR).
    await admin.from('chat_ai_decisions').insert({
      report_id: reportId,
      message_id: triggeringMessageId,
      category: 'unknown',
      confidence: null,
      rationale: `ESCALATION_PUSH_FAILED: ${msg.slice(0, 480)}`,
      driver_message_text: driverText.slice(0, 500),
      classified_at: new Date().toISOString(),
    });
  } catch (auditErr) {
    await logger.error('chat.escalation audit insert también falló', { auditErr });
  }
}

interface MediateOpts {
  reportId: string;
  messageId: string;
  driverText: string;
  isFirstMessage: boolean;
  zoneId: string | null;
}

/**
 * AI mediator: clasifica mensaje, auto-respond si trivial, escala si real.
 * Siempre escribe en chat_ai_decisions para audit (service-role para bypass RLS).
 */
async function mediateChatMessage(opts: MediateOpts): Promise<void> {
  const { reportId, messageId, driverText, isFirstMessage, zoneId } = opts;
  const result = await classifyDriverMessage(driverText);

  // Service role para insertar auto-reply (sender='system' lo requiere) y audit.
  const admin = createServiceRoleClient();

  let autoReplyMessageId: string | null = null;
  if (result.category === 'trivial' && result.autoReply) {
    const { data: replyRow, error: replyErr } = await admin
      .from('messages')
      .insert({
        report_id: reportId,
        sender: 'system',
        sender_user_id: null,
        text: result.autoReply,
        image_url: null,
      })
      .select('id')
      .single();
    if (replyErr) {
      await logger.error('chat.mediator.autoReply insert falló', {
        reportId, err: replyErr.message,
      });
    } else {
      autoReplyMessageId = replyRow?.id ?? null;
    }
  }

  // Audit insert (sin bloquear si falla — no es crítico operativamente).
  const { error: auditErr } = await admin.from('chat_ai_decisions').insert({
    message_id: messageId,
    report_id: reportId,
    driver_message_text: driverText,
    category: result.category,
    auto_reply: result.autoReply,
    confidence: result.confidence,
    rationale: result.rationale,
    auto_reply_message_id: autoReplyMessageId,
  });
  if (auditErr) {
    await logger.warn('chat.mediator.audit insert falló', {
      reportId, err: auditErr.message,
    });
  }

  // Escalar a admin/dispatcher/zone_manager si NO es trivial. Solo en primer mensaje
  // (resto va al chat normal sin push).
  // 'unknown' → escalamos por seguridad.
  if (result.category !== 'trivial' && isFirstMessage && zoneId) {
    void sendChatPushToZoneManagers({ reportId, zoneId }).catch(async (e) => {
      await logger.error('chat.push fanout falló', { reportId, zoneId, err: e });
    });
  }
}

/**
 * Marca el chat como resuelto desde el lado del chofer.
 * Cierra el caso pero el zone_manager aún puede marcarlo como `manager_resolved`.
 * En la práctica, el primero gana.
 */
export async function resolveChatByDriverAction(reportId: string): Promise<Result> {
  const supabase = await createServerClient();
  const { error } = await supabase
    .from('delivery_reports')
    .update({
      chat_status: 'driver_resolved',
      resolved_at: new Date().toISOString(),
    })
    .eq('id', reportId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
