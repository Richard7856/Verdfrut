// Fanout de push notifications desde el driver app.
// Hoy un solo caso de uso: avisar al zone_manager de la zona del chofer cuando
// se abre un chat (primer mensaje del flujo) — ADR-021.
//
// Por qué no compartimos `apps/platform/src/lib/push.ts`:
// el archivo es server-only y los apps no comparten src/. Mover a paquete
// `@verdfrut/notifications` valdrá cuando aparezca el tercer consumidor.
// Por ahora copiamos la pieza mínima que driver necesita.

import 'server-only';
import webpush from 'web-push';
import { createServiceRoleClient } from '@verdfrut/supabase/server';
import { logger } from '@verdfrut/observability';

let vapidConfigured = false;
function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;
  if (!vapidPublic || !vapidPrivate || !vapidSubject) return false;
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
  vapidConfigured = true;
  return true;
}

interface ChatPushParams {
  reportId: string;
  zoneId: string;
}

/**
 * Notifica a TODOS los zone_managers de una zona que un chofer abrió chat.
 * Estrategia "fanout": cada manager recibe la noti con deep link al chat.
 * Cuando un manager toca, le toca atender (no hay asignación 1-a-1).
 *
 * Sin VAPID configurado: log y skip — no falla.
 * Endpoints muertos (404/410): se eliminan automáticamente.
 *
 * El URL apunta a la app de plataforma (env DRIVER_APP_URL no aplica aquí —
 * el comercial vive en NEXT_PUBLIC_PLATFORM_URL o equivalente).
 */
export async function sendChatPushToZoneManagers(params: ChatPushParams): Promise<void> {
  if (!ensureVapidConfigured()) {
    await logger.warn('chat.push VAPID no configurado — push omitido', { ...params });
    return;
  }

  const supabase = createServiceRoleClient();

  // V2: fanout amplio — envía a TODOS los que pueden actuar sobre el reporte:
  //   - zone_managers de la zona específica
  //   - admin (sin filtro de zona — admin global ve todo)
  //   - dispatcher (sin filtro de zona — operación full)
  // RLS bypaseada con service role.
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth, role, zone_id')
    .or(
      `and(role.eq.zone_manager,zone_id.eq.${params.zoneId}),role.eq.admin,role.eq.dispatcher`,
    );

  if (error) {
    await logger.error('chat.push error leyendo subscriptions', { zoneId: params.zoneId, err: error });
    return;
  }
  if (!subs || subs.length === 0) {
    await logger.warn('chat.push sin destinatarios suscritos', { zoneId: params.zoneId });
    return;
  }

  const platformUrl = process.env.PLATFORM_APP_URL ?? 'http://localhost:3000';
  const payload = JSON.stringify({
    title: 'Nuevo chat de incidencia',
    body: 'Un chofer abrió un caso. Toca para responder.',
    url: `${platformUrl}/incidents/${params.reportId}`,
    tag: `chat-${params.reportId}`,
  });

  for (const sub of subs as Array<{ id: string; endpoint: string; p256dh: string; auth: string }>) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        payload,
        { TTL: 3600, urgency: 'high' },
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        console.info(`[chat.push] suscripción ${sub.id} eliminada (${statusCode})`);
      } else {
        console.error('[chat.push] envío falló:', err);
      }
    }
  }
}
