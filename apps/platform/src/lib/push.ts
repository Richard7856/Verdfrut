// Push notifications via Web Push (VAPID).
// Server-only — usa SUPABASE_SERVICE_ROLE_KEY para leer push_subscriptions sin RLS.
//
// Uso:
//   await notifyDriverOfPublishedRoute(routeId);
//
// Si VAPID no está configurado (env faltante) o el chofer no tiene suscripciones,
// la función registra un warning y no hace nada — graceful degrade. La ruta queda
// PUBLISHED en DB y el chofer la verá cuando abra la app.
//
// La implementación real de web-push como dep se hace en Fase 2 (driver app).
// Por ahora, este stub solo loggea para que el flujo de logística no falle.

import 'server-only';
import { createServiceRoleClient } from '@verdfrut/supabase/server';

interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag?: string;
}

/**
 * Lee las suscripciones push de un usuario y envía una notificación a cada device.
 * Sin VAPID configurado, solo loggea — no falla.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT;

  if (!vapidPublic || !vapidPrivate || !vapidSubject) {
    console.warn('[push] VAPID keys no configuradas — push omitido', { userId, payload });
    return { sent: 0, failed: 0 };
  }

  const supabase = createServiceRoleClient();
  const { data: subs, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (error) {
    console.error('[push] Error leyendo suscripciones:', error);
    return { sent: 0, failed: 0 };
  }

  if (!subs || subs.length === 0) {
    console.warn(`[push] Usuario ${userId} no tiene suscripciones — push omitido`);
    return { sent: 0, failed: 0 };
  }

  // Implementación real con web-push: pendiente para Fase 2.
  // Por ahora, hacemos un fetch directo al endpoint (limitado a Web Push protocol simple).
  // Cuando se instale `web-push`, reemplazar este bloque por webpush.sendNotification.
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);

  for (const sub of subs as Array<{ endpoint: string; p256dh: string; auth: string }>) {
    try {
      // STUB: hasta integrar web-push en Fase 2, solo loggear.
      // const result = await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      console.info(`[push:stub] enviaría a ${sub.endpoint.slice(0, 40)}…`, { payload, body: body.length });
      sent++;
    } catch (err) {
      console.error('[push] Falló envío a', sub.endpoint, err);
      failed++;
    }
  }

  return { sent, failed };
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
