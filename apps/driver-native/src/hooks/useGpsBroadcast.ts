// Hook controlador del GPS background task.
//
// Responsabilidad:
//   - Si `enabled` (route IN_PROGRESS + driverId presente) → arranca el task.
//   - Si `enabled=false` → detiene el task.
//   - Expone estado para UI: running, lastBreadcrumbAt, denial reason si aplica.
//
// El task corre del lado del OS — este hook NO sabe del fix actual, sólo
// controla on/off + lee marca de tiempo del último write a DB.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getLastBreadcrumbAt,
  isGpsTaskRunning,
  startGpsTask,
  stopGpsTask,
} from '@/lib/gps-task';

interface UseGpsBroadcastArgs {
  routeId: string | null;
  driverId: string | null;
  enabled: boolean;
}

export interface GpsBroadcastState {
  running: boolean;
  /** Último breadcrumb persistido (ms epoch) o null si nada aún. */
  lastBreadcrumbAt: number | null;
  /** Si el último intento de arrancar falló, el motivo. */
  denial: 'foreground_denied' | 'background_denied' | 'start_failed' | null;
  denialDetail: string | null;
}

const POLL_INTERVAL_MS = 5_000;

export function useGpsBroadcast({
  routeId,
  driverId,
  enabled,
}: UseGpsBroadcastArgs): GpsBroadcastState {
  const [state, setState] = useState<GpsBroadcastState>({
    running: false,
    lastBreadcrumbAt: null,
    denial: null,
    denialDetail: null,
  });

  // Evitar arrancar/detener en flight si ya lo estamos haciendo (re-mount race).
  const inFlightRef = useRef(false);

  const start = useCallback(async () => {
    if (inFlightRef.current || !routeId || !driverId) return;
    inFlightRef.current = true;
    try {
      const res = await startGpsTask({ routeId, driverId });
      if (res.ok) {
        setState((s) => ({ ...s, running: true, denial: null, denialDetail: null }));
      } else {
        setState((s) => ({
          ...s,
          running: false,
          denial: res.reason,
          denialDetail: 'detail' in res ? (res.detail ?? null) : null,
        }));
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [routeId, driverId]);

  const stop = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      await stopGpsTask();
      setState((s) => ({ ...s, running: false }));
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Reaccionar a cambios de enabled / routeId / driverId.
  useEffect(() => {
    if (enabled && routeId && driverId) {
      void start();
    } else {
      void stop();
    }
  }, [enabled, routeId, driverId, start, stop]);

  // Limpieza al desmontar — sólo si el dueño dice que ya no debe correr.
  // Si la pantalla cambia pero la ruta sigue IN_PROGRESS, no queremos
  // detener el task. Por eso el cleanup NO llama stop() automático;
  // el task vive más allá de la pantalla.

  // Poll periódico para refrescar lastBreadcrumbAt + sincronizar running con OS.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function tick() {
      if (cancelled) return;
      const [running, last] = await Promise.all([isGpsTaskRunning(), getLastBreadcrumbAt()]);
      if (cancelled) return;
      setState((s) => {
        // Sólo actualizar si cambia para evitar re-renders inútiles.
        if (s.running === running && s.lastBreadcrumbAt === last) return s;
        return { ...s, running, lastBreadcrumbAt: last };
      });
    }

    void tick();
    timer = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return state;
}
