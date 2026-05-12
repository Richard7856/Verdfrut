'use client';

// Registra el service worker compilado por Serwist (public/sw.js).
// Sólo se ejecuta en producción — en dev Serwist está deshabilitado en next.config.ts
// para no interferir con el HMR.

import { useEffect } from 'react';
import { logger } from '@tripdrive/observability';

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        console.info('[sw] Service worker registrado:', reg.scope);
      })
      .catch((err) => {
        // No es fatal — la app sigue funcionando online.
        void logger.error('[sw] Falló registro del service worker', { err });
      });
  }, []);

  return null;
}
