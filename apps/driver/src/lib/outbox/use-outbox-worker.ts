'use client';

// Hook que mantiene el worker del outbox vivo mientras el componente está
// montado. Lo monta el layout o la página principal del driver — un solo
// instance, no proliferar.
//
// Estrategia:
//  - tick cada 5s mientras online: drena un item por tick.
//  - listener 'online' → procesar inmediatamente al recuperar red.
//  - GC cada 5 minutos para borrar items done >24h.

import { useEffect } from 'react';
import { processOnce, gc, recoverInFlight } from './queue';

const TICK_MS = 5000;
const GC_MS = 5 * 60 * 1000;

export function useOutboxWorker(): void {
  useEffect(() => {
    let cancelled = false;
    let tickHandle: ReturnType<typeof setInterval> | null = null;
    let gcHandle: ReturnType<typeof setInterval> | null = null;

    async function drain() {
      if (cancelled) return;
      // Drenar varios items seguidos si hay backlog y red ok.
      // Cap a 5 por tick para no monopolizar el thread.
      for (let i = 0; i < 5; i++) {
        if (cancelled) return;
        const did = await processOnce();
        if (!did) break;
      }
    }

    function onOnline() {
      void drain();
    }

    // Recovery primero: items in_flight de sesión anterior pasan a pending.
    // Luego kick inmediato del worker.
    void recoverInFlight().then(() => drain());
    tickHandle = setInterval(drain, TICK_MS);
    gcHandle = setInterval(() => { void gc(); }, GC_MS);
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onOnline);
    }

    return () => {
      cancelled = true;
      if (tickHandle) clearInterval(tickHandle);
      if (gcHandle) clearInterval(gcHandle);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onOnline);
      }
    };
  }, []);
}
