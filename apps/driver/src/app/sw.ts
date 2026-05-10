// Service Worker fuente para la PWA del chofer.
// Serwist lo compila a public/sw.js durante el build.
//
// Responsabilidades:
//   1. Precachear shell de la app (JS, CSS, manifest, íconos).
//   2. Network-first para APIs (datos de chofer cambian seguido).
//   3. Cache-first para assets estáticos (íconos, fuentes).
//   4. Recibir push notifications VAPID y mostrar notificación al chofer.
//   5. Click en notificación → abre la URL específica (ej: /route/{id}).

import { defaultCache } from '@serwist/next/worker';
import { Serwist } from 'serwist';
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist';

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Inyectado por @serwist/next en build time con la lista de assets a precachear.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();

// Push notification handler. El payload viene del platform vía web-push.
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload: { title: string; body: string; url?: string; tag?: string };
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'TripDrive', body: event.data.text() };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.tag,
      data: { url: payload.url ?? '/' },
      requireInteraction: false,
    }),
  );
});

// Click en notificación → enfocar tab existente o abrir nueva.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data as { url?: string } | undefined)?.url ?? '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Si ya hay una ventana abierta, navegarla al target.
      for (const client of allClients) {
        if ('focus' in client) {
          await (client as WindowClient).focus();
          if ('navigate' in client) {
            await (client as WindowClient).navigate(targetUrl);
          }
          return;
        }
      }
      // Si no hay ventana, abrir nueva.
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
