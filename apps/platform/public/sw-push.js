// Service Worker minimal para el platform — SOLO push notifications.
// NO precachea assets ni intercepta fetches (el driver app sí lo hace via Serwist
// porque es PWA installable; el platform es un dashboard web normal sin offline).
//
// Responsabilidades:
//   1. Recibir push notifications VAPID enviadas por push-fanout.ts del driver.
//   2. Mostrar notificación nativa del SO con título + body.
//   3. Click en notificación → enfocar tab existente o abrir nueva en la URL.
//
// Servido como /sw-push.js desde apps/platform/public — scope automático "/".

self.addEventListener('install', (event) => {
  // Activar inmediatamente, sin esperar a que el SW viejo termine sus clients.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Tomar control de todos los clients (tabs) abiertos.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'VerdFrut', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'VerdFrut', {
      body: payload.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      data: { url: payload.url || '/' },
      requireInteraction: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Si ya hay una ventana abierta del platform, navegarla al target.
      for (const client of allClients) {
        if ('focus' in client) {
          await client.focus();
          if ('navigate' in client) {
            await client.navigate(targetUrl);
          }
          return;
        }
      }
      // Si no hay ventana abierta, abrir una nueva.
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
