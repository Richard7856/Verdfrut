// Fanout de push notifications desde el driver app.
// Hoy un solo caso de uso: avisar al zone_manager de la zona del chofer cuando
// se abre un chat (primer mensaje del flujo) — ADR-021.
//
// Por qué no compartimos `apps/platform/src/lib/push.ts`:
// el archivo es server-only y los apps no comparten src/. Mover a paquete
// `@tripdrive/notifications` valdrá cuando aparezca el tercer consumidor.
// Por ahora copiamos la pieza mínima que driver necesita.
//
// ADR-081 (Stream B / N5): el fanout también envía a tokens nativos Expo
// (`platform='expo'`) cuando el destinatario es un chofer con la app nativa.
// La query trae ambos tipos de subs (web + expo); el loop divide y manda por
// cada canal correspondiente (web-push vs Expo Push API).

import 'server-only';
import webpush from 'web-push';
import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { createServiceRoleClient } from '@tripdrive/supabase/server';
import { logger } from '@tripdrive/observability';

const expo = new Expo();

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
interface PushSubRow {
  id: string;
  platform: 'web' | 'expo';
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  expo_token: string | null;
  role: string;
  zone_id: string | null;
}

export async function sendChatPushToZoneManagers(params: ChatPushParams): Promise<void> {
  const supabase = createServiceRoleClient();

  // Issue #216 (ADR-088): derivar customer_id de la zone y filtrar destinatarios
  // por el mismo customer. Sin esto, un push de customer A llegaría a admins de
  // customer B porque el role-based filter no contempla multi-tenancy.
  const { data: zoneRow, error: zoneErr } = await supabase
    .from('zones')
    .select('customer_id')
    .eq('id', params.zoneId)
    .maybeSingle();

  if (zoneErr || !zoneRow?.customer_id) {
    await logger.error('chat.push: zone sin customer_id', {
      zoneId: params.zoneId,
      err: zoneErr,
    });
    return;
  }
  const customerId = zoneRow.customer_id;

  // Resolver user_ids dentro del customer que deben recibir la noti:
  //   - zone_managers de la zona específica
  //   - admin / dispatcher del customer (sin filtro de zona)
  const { data: users, error: usersErr } = await supabase
    .from('user_profiles')
    .select('id, role, zone_id')
    .eq('customer_id', customerId)
    .or(
      `role.eq.admin,role.eq.dispatcher,and(role.eq.zone_manager,zone_id.eq.${params.zoneId})`,
    );

  if (usersErr) {
    await logger.error('chat.push error resolviendo users del customer', {
      customerId, zoneId: params.zoneId, err: usersErr,
    });
    return;
  }
  const userIds = (users ?? []).map((u) => u.id as string);
  if (userIds.length === 0) {
    await logger.warn('chat.push sin destinatarios del customer', { customerId });
    return;
  }

  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, platform, endpoint, p256dh, auth, expo_token, role, zone_id')
    .in('user_id', userIds);

  if (error) {
    await logger.error('chat.push error leyendo subscriptions', { zoneId: params.zoneId, err: error });
    return;
  }
  if (!subs || subs.length === 0) {
    await logger.warn('chat.push sin destinatarios suscritos', { zoneId: params.zoneId });
    return;
  }

  const rows = subs as PushSubRow[];
  const webSubs = rows.filter((s) => s.platform === 'web');
  const expoSubs = rows.filter((s) => s.platform === 'expo');

  const platformUrl = process.env.PLATFORM_APP_URL ?? 'http://localhost:3000';
  const title = 'Nuevo chat de incidencia';
  const body = 'Un chofer abrió un caso. Toca para responder.';
  const reportUrl = `${platformUrl}/incidents/${params.reportId}`;
  const tag = `chat-${params.reportId}`;

  await Promise.all([
    sendWebPushBatch(webSubs, { title, body, url: reportUrl, tag }),
    sendExpoPushBatch(expoSubs, {
      title,
      body,
      data: { reportId: params.reportId, url: reportUrl },
    }),
  ]);
}

interface WebPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

async function sendWebPushBatch(subs: PushSubRow[], payload: WebPayload): Promise<void> {
  if (subs.length === 0) return;
  if (!ensureVapidConfigured()) {
    await logger.warn('chat.push VAPID no configurado — webpush omitido', {});
    return;
  }
  const supabase = createServiceRoleClient();
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    if (!sub.endpoint || !sub.p256dh || !sub.auth) continue;
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 3600, urgency: 'high' },
      );
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        console.info(`[chat.push.web] suscripción ${sub.id} eliminada (${statusCode})`);
      } else {
        await logger.error('[chat.push.web] envío falló', { err, subscriptionId: sub.id });
      }
    }
  }
}

interface ExpoPayload {
  title: string;
  body: string;
  data: Record<string, string>;
}

async function sendExpoPushBatch(subs: PushSubRow[], payload: ExpoPayload): Promise<void> {
  if (subs.length === 0) return;

  const supabase = createServiceRoleClient();

  // Construir mensajes válidos. Tokens inválidos los removemos de la DB.
  const messages: ExpoPushMessage[] = [];
  const subBySendIndex: PushSubRow[] = []; // para mapear ticket→sub al recibir error
  const invalidSubIds: string[] = [];

  for (const sub of subs) {
    if (!sub.expo_token || !Expo.isExpoPushToken(sub.expo_token)) {
      invalidSubIds.push(sub.id);
      continue;
    }
    messages.push({
      to: sub.expo_token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      priority: 'high',
      channelId: 'default',
    });
    subBySendIndex.push(sub);
  }

  if (invalidSubIds.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', invalidSubIds);
    console.info(`[chat.push.expo] removidos ${invalidSubIds.length} tokens inválidos`);
  }

  if (messages.length === 0) return;

  // Expo recomienda chunkear hasta 100 mensajes por request.
  const chunks = expo.chunkPushNotifications(messages);
  let subOffset = 0;
  for (const chunk of chunks) {
    if (!chunk) continue;
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      // Si el ticket dice "DeviceNotRegistered", el token ya no sirve —
      // limpiarlo. Otros errores los logueamos.
      for (let j = 0; j < tickets.length; j++) {
        const ticket = tickets[j];
        const sub = subBySendIndex[subOffset + j];
        if (ticket && ticket.status === 'error') {
          const code = ticket.details?.error;
          if (code === 'DeviceNotRegistered' && sub) {
            await supabase.from('push_subscriptions').delete().eq('id', sub.id);
            console.info(`[chat.push.expo] token ${sub.id} removido (DeviceNotRegistered)`);
          } else {
            await logger.error('[chat.push.expo] ticket error', {
              code,
              message: ticket.message,
              subscriptionId: sub?.id,
            });
          }
        }
      }
    } catch (err) {
      await logger.error('[chat.push.expo] chunk send falló', { err });
    }
    subOffset += chunk.length;
  }
}
