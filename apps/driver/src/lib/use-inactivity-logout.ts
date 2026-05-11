'use client';

// Cierra sesión automáticamente tras 8h sin actividad — issue #15.
// El timestamp se persiste en localStorage para sobrevivir recargas.
// El check se dispara cuando el app vuelve al foreground (visibilitychange)
// y en cada mount de página, cubriendo el caso "teléfono prestado tras horas".

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserClient } from '@tripdrive/supabase/browser';

const STORAGE_KEY = 'vf-last-active';
// 8h = jornada completa. Si el chofer deja el teléfono toda la noche, al día
// siguiente la sesión está cerrada y debe volver a autenticarse.
const TIMEOUT_MS = 8 * 60 * 60 * 1000;

export function useInactivityLogout(): void {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserClient();

    function stamp(): void {
      try {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
      } catch {
        // localStorage lleno (modo incógnito muy poblado) — silencioso, no bloqueamos operación
      }
    }

    async function checkAndLogout(): Promise<void> {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      // Sin sesión activa no hay nada que cerrar
      if (!session) return;

      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        // Primera vez con sesión activa — inicializar reloj
        stamp();
        return;
      }

      const lastActive = parseInt(raw, 10);
      if (!isNaN(lastActive) && Date.now() - lastActive > TIMEOUT_MS) {
        localStorage.removeItem(STORAGE_KEY);
        await supabase.auth.signOut();
        router.replace('/login');
      }
    }

    function onVisibilityChange(): void {
      if (document.visibilityState === 'hidden') {
        // App va a background — guardar el momento exacto de salida
        stamp();
      } else {
        // App vuelve al foreground — verificar si el timeout expiró mientras estaba fuera
        checkAndLogout();
      }
    }

    const ACTIVITY_EVENTS = ['touchstart', 'click', 'keydown'] as const;
    ACTIVITY_EVENTS.forEach((ev) => document.addEventListener(ev, stamp, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Check en mount: cubre reload manual después de horas de inactividad
    checkAndLogout();

    return () => {
      ACTIVITY_EVENTS.forEach((ev) => document.removeEventListener(ev, stamp));
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [router]);
}
