'use client';

// Hook GPS broadcast para el chofer.
//
// Responsabilidades:
//   1. Pedir permiso de geolocalización al chofer.
//   2. Suscribir Geolocation.watchPosition (alta precisión).
//   3. Publicar al canal Realtime `gps:{routeId}` cada 5-10s.
//      → El supervisor de zona escucha este canal en /routes/[id] o /map.
//   4. Cada N minutos persistir un breadcrumb en route_breadcrumbs (audit trail).
//   5. Limpiar todo cuando el componente desmonte o la ruta termine.
//
// Decisiones técnicas:
// - Throttling client-side: watchPosition puede emitir cada segundo en algunos
//   dispositivos. No queremos saturar Realtime ni la DB. Limitamos a 1 broadcast
//   cada `BROADCAST_INTERVAL_MS` y 1 breadcrumb cada `BREADCRUMB_INTERVAL_MS`.
// - Wake Lock API: cuando el chofer está navegando, mantenemos pantalla encendida
//   (sin bloqueo) para que la app no muera por inactividad. Si Wake Lock no está
//   disponible (Safari iOS sin compatibilidad), graceful degrade.
// - Manejo de permisos: si el chofer rechaza geo, retornamos `error` y la UI
//   debe mostrarle cómo habilitarlo. NO bloqueamos el resto de la app.

import { useEffect, useRef, useState } from 'react';
import { createBrowserClient } from '@verdfrut/supabase/browser';

const BROADCAST_INTERVAL_MS = 8_000;     // emitir al supervisor cada 8s
const BREADCRUMB_INTERVAL_MS = 90_000;   // persistir DB cada 1.5 min

export interface GpsBroadcastState {
  /** True si watchPosition está activo. */
  active: boolean;
  /** Último error del API (geo denegada, sin red, etc.). null si todo va bien. */
  error: string | null;
  /** Última posición conocida (debug). */
  lastPosition: GeolocationPosition | null;
  /** # de broadcasts enviados (debug). */
  broadcastCount: number;
}

interface UseGpsBroadcastOpts {
  routeId: string;
  driverId: string;
  /** Si false, el hook queda inerte (útil para no consumir batería antes de iniciar ruta). */
  enabled: boolean;
}

export function useGpsBroadcast(opts: UseGpsBroadcastOpts): GpsBroadcastState {
  const { routeId, driverId, enabled } = opts;
  const [state, setState] = useState<GpsBroadcastState>({
    active: false,
    error: null,
    lastPosition: null,
    broadcastCount: 0,
  });

  // Refs para no re-suscribir en cada render. Las usamos para mantener
  // el último timestamp de broadcast/breadcrumb y el canal Supabase.
  const lastBroadcastRef = useRef(0);
  const lastBreadcrumbRef = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'Tu navegador no soporta geolocalización' }));
      return;
    }

    const supabase = createBrowserClient();
    const channelName = `gps:${routeId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } }, // no recibir nuestros propios broadcasts
    });
    channel.subscribe();

    // Wake Lock — mantener pantalla encendida durante la ruta. Best-effort.
    if ('wakeLock' in navigator) {
      navigator.wakeLock
        .request('screen')
        .then((lock) => {
          wakeLockRef.current = lock;
        })
        .catch((err) => console.warn('[gps] wake lock denegado:', err));
    }

    function handlePosition(pos: GeolocationPosition) {
      const now = Date.now();
      setState((s) => ({ ...s, lastPosition: pos, error: null, active: true }));

      const payload = {
        driver_id: driverId,
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        speed: pos.coords.speed ?? null,        // m/s, null si no disponible
        heading: pos.coords.heading ?? null,    // grados desde norte
        accuracy: pos.coords.accuracy,
        ts: new Date(pos.timestamp).toISOString(),
      };

      // 1. Broadcast Realtime (transitorio, no DB) si pasó el throttle.
      if (now - lastBroadcastRef.current >= BROADCAST_INTERVAL_MS) {
        lastBroadcastRef.current = now;
        channel
          .send({ type: 'broadcast', event: 'position', payload })
          .catch((err) => console.warn('[gps] broadcast falló:', err));
        setState((s) => ({ ...s, broadcastCount: s.broadcastCount + 1 }));
      }

      // 2. Breadcrumb a DB (audit) si pasó el throttle más largo.
      if (now - lastBreadcrumbRef.current >= BREADCRUMB_INTERVAL_MS) {
        lastBreadcrumbRef.current = now;
        // Insert en route_breadcrumbs vía RLS (driver puede insertar suyos).
        supabase
          .from('route_breadcrumbs')
          .insert({
            route_id: routeId,
            driver_id: driverId,
            lat: payload.lat,
            lng: payload.lng,
            speed: payload.speed,
            heading: payload.heading,
            recorded_at: payload.ts,
          })
          .then(({ error }) => {
            if (error) console.warn('[gps] breadcrumb falló:', error.message);
          });
      }
    }

    function handleError(err: GeolocationPositionError) {
      const messages: Record<number, string> = {
        1: 'Permiso de ubicación denegado',
        2: 'No se pudo obtener ubicación',
        3: 'Tiempo de espera agotado',
      };
      setState((s) => ({
        ...s,
        active: false,
        error: messages[err.code] ?? `Error de geolocalización (${err.code})`,
      }));
    }

    const watchId = navigator.geolocation.watchPosition(handlePosition, handleError, {
      enableHighAccuracy: true,
      maximumAge: 5_000,        // aceptar lectura cacheada de hasta 5s
      timeout: 30_000,          // si no hay fix en 30s, manda error
    });

    return () => {
      navigator.geolocation.clearWatch(watchId);
      channel.unsubscribe();
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
      setState({ active: false, error: null, lastPosition: null, broadcastCount: 0 });
    };
  }, [routeId, driverId, enabled]);

  return state;
}
