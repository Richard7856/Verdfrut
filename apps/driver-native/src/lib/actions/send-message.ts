// Envío de mensaje del chofer al chat. Insert directo vía Supabase con RLS
// validando sender='driver' + sender_user_id = auth.uid().
//
// LIMITACIONES vs el web (documentado en ADR-082):
//   - NO corre el AI mediator (classifyDriverMessage). El mediator vive en el
//     server action del web; replicarlo desde native requeriría un proxy
//     endpoint (similar a OCR). Mientras tanto, los mensajes del chofer
//     siempre escalan al zone_manager — no hay auto-respuesta de Claude para
//     mensajes triviales. Issue #197.
//   - El trigger `tg_messages_open_chat` server-side sigue funcionando: setea
//     `chat_opened_at` y `timeout_at` al primer mensaje. La fanout de push
//     al zone_manager NO ocurre desde aquí (la dispara el web server action).
//     Para que ocurra desde native necesitamos webhook o proxy → issue #198.

import { supabase } from '@/lib/supabase';

const MAX_CHAT_TEXT = 2000;

export type SendMessageResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function sendMessage(
  reportId: string,
  text: string,
): Promise<SendMessageResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, error: 'El mensaje no puede estar vacío.' };
  }
  if (trimmed.length > MAX_CHAT_TEXT) {
    return {
      ok: false,
      error: `Mensaje demasiado largo (máx ${MAX_CHAT_TEXT} caracteres).`,
    };
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) {
    return { ok: false, error: 'Sesión expirada.' };
  }

  const { data, error } = await supabase
    .from('messages')
    .insert({
      report_id: reportId,
      sender: 'driver',
      sender_user_id: userId,
      text: trimmed,
      image_url: null,
    })
    .select('id')
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'No se pudo enviar el mensaje.' };
  }
  return { ok: true, id: data.id };
}
