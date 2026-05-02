// Push notifications via Web Push (VAPID).
// Server-only — usa SUPABASE_SERVICE_ROLE_KEY para leer push_subscriptions sin RLS.
//
// Uso:
//   await notifyDriverOfPublishedRoute(routeId);
//
// Comportamiento sin VAPID configurado: graceful degrade — log warning y skip.
// La ruta queda PUBLISHED en DB y el chofer la verá al abrir la PWA.
//
// Suscripciones inválidas (404, 410 del push service): se eliminan automático
// para que la próxima vez no se vuelvan a intentar.

import 'server-only';
import webpush from 'web-push';
import { createServiceRoleClient } from '@verdfrut/supabase/server';

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Configura las VAPID keys de web-push una sola vez por proceso.
 * Las keys se leen del env. Si faltan, devuelve false y el caller debe abortar.
 */
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

/**
 * Lee las suscripciones push de un usuario y envía una notificación a cada device.
 * Sin VAPID configurado, solo loggea — no falla.
 *
 * Si el push service responde 404/410, esa subscription quedó muerta (usuario
 * desinstaló, cambió device, revocó permiso) — la borramos para no acumular basura.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number; pruned: number }> {
  if (!ensureVapidConfigured()) {
    console.warn('[push] VAPID keys no configuradas — push omitido', { userId, payload });
    return { sent: 0, failed: 0, pruned: 0 };
  }

  const supabase = createServiceRoleClient();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    console.error('[push] Error leyendo suscripciones:', error);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  if (!subs || subs.length === 0) {
    console.warn(`[push] Usuario ${userId} no tiene suscripciones — push omitido`);
    return { sent: 0, failed: 0, pruned: 0 };
  }

  let sent = 0;
  let failed = 0;
  let pruned = 0;
  const body = JSON.stringify(payload);

  for (const sub of subs as Array<{
    id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }>) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        {
          TTL: 3600, // 1 hora — si el chofer no recibe en 1h, la noti es irrelevante
          urgency: 'high',
        },
      );
      sent++;
    } catch (err) {
      const statusCode = (err as { statusCode?: number }).statusCode;
      // 404 = endpoint no existe; 410 = endpoint dado de baja por el push service.
      // En ambos casos, la subscription quedó muerta — borrar para no reintentar.
      if (statusCode === 404 || statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
        pruned++;
        console.info(`[push] Suscripción ${sub.id} eliminada (statusCode=${statusCode})`);
      } else {
        failed++;
        console.error('[push] Falló envío a', sub.endpoint.slice(0, 60), err);
      }
    }
  }

  return { sent, failed, pruned };
}

/**
 * Notifica al chofer asignado que una ruta fue publicada.
 * Si la ruta no tiene chofer asignado, log warning y skip (no es error fatal).
 */
export async function notifyDriverOfPublishedRoute(routeId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Resolver el user_id del chofer asignado a esta ruta.
  const { data: route, error: routeErr } = await supabase
    .from('routes')
    .select('id, name, driver_id, drivers!routes_driver_id_fkey(user_id)')
    .eq('id', routeId)
    .single();

  if (routeErr || !route) {
    console.error('[push] No se pudo cargar ruta para notificar:', routeErr);
    return;
  }

  // El embed de Supabase devuelve drivers como array (incluso para FK a 1).
  const routeData = route as unknown as {
    name: string;
    drivers?: Array<{ user_id: string }> | { user_id: string } | null;
  };
  const driverEmbed = Array.isArray(routeData.drivers) ? routeData.drivers[0] : routeData.drivers;
  const driverUserId = driverEmbed?.user_id;

  if (!driverUserId) {
    console.warn(`[push] Ruta ${routeId} no tiene chofer asignado — push omitido`);
    return;
  }

  await sendPushToUser(driverUserId, {
    title: 'Nueva ruta asignada',
    body: `${routeData.name} — toca para ver paradas`,
    url: `/route/${routeId}`,
    tag: `route-${routeId}`,
  });
}
