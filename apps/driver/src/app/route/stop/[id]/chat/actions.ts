'use server';

// Server actions del chat (lado driver).
// Las llamadas pasan por el outbox (ADR-021 / send_chat_message), pero exponemos
// también los actions raw para que el handler las ejecute.
//
// Reglas de RLS (migración 018):
//  - sender = 'driver' AND current_user_role() = 'driver'
//  - sender_user_id = auth.uid()
// Por tanto el chofer no puede mentir sobre su rol.

import { createServerClient } from '@verdfrut/supabase/server';
import { sendChatPushToZoneManagers } from '@/lib/push-fanout';
import { consume, LIMITS } from '@/lib/rate-limit';

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

  // Push fanout solo en el primer mensaje, sin bloquear la respuesta.
  if (isFirstMessage && zoneId) {
    void sendChatPushToZoneManagers({ reportId, zoneId }).catch((e) => {
      console.error('[chat.push] fanout falló:', e);
    });
  }

  return { ok: true, data: { id: data.id } };
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
