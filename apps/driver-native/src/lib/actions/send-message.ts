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
//
// HARDENING (ADR-083):
//   Rate limit via `tripdrive_rate_limit_check` RPC — máx 30 mensajes/min
//   por chofer. Mitiga AV-#1 (cookie theft → spam de mensajes que saturan
//   al supervisor) y AV-#5 (chofer comprometido enviando ruido).

import { supabase } from '@/lib/supabase';

const MAX_CHAT_TEXT = 2000;
const RATE_LIMIT_KEY = 'native-chat-send';
const RATE_LIMIT_MAX_PER_MINUTE = 30;
const RATE_LIMIT_WINDOW_SECONDS = 60;

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

  // Rate limit anti-spam. RPC `tripdrive_rate_limit_check` valida server-side
  // contra `rate_limit_buckets` (ADR-054). Si excede, devuelve false sin
  // contar el intento como hit (decisión del RPC: gate antes de increment).
  const { data: allowed, error: rateErr } = await supabase.rpc('tripdrive_rate_limit_check', {
    p_bucket_key: `${RATE_LIMIT_KEY}:${userId}`,
    p_max_hits: RATE_LIMIT_MAX_PER_MINUTE,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  });
  if (rateErr) {
    // Si el RPC falla (caída de BD, etc.), seguimos optimísticamente — el
    // RLS y el resto de protecciones siguen activos. Loggeamos warn pero
    // no bloqueamos al chofer por un fallo de infra de rate-limit.
    console.warn('[sendMessage] rate-limit check falló:', rateErr.message);
  } else if (allowed === false) {
    return {
      ok: false,
      error: `Estás enviando mensajes muy rápido. Espera un momento (máx ${RATE_LIMIT_MAX_PER_MINUTE}/min).`,
    };
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
