'use client';

// Hook que sigue la posición del chofer con watchPosition para la pantalla
// de navegación. Distinto del hook de gps-broadcast.ts (ese es para emitir
// al supervisor); este es para uso LOCAL — mover el marker en el mapa,
// calcular distancia a la próxima parada, detectar arrival.
//
// Devuelve:
//   - position: última posición (null hasta que llega la primera lectura)
//   - error: string si geolocation falla
//   - state: 'starting' | 'tracking' | 'denied' | 'unavailable'
//
// Mantiene la última posición en memoria (no localStorage) — si el chofer
// recarga la página, vuelve a pedir GPS. Esto es por simplicidad; persistir
// localStorage permitiría arranque más rápido pero queda obsoleto si el chofer
// se movió mientras la app estaba cerrada.

import { useEffect, useState } from 'react';

export interface DriverPosition {
  lat: number;
  lng: number;
  accuracy: number;
  heading: number | null;  // grados desde norte (null si no se mueve)
  speed: number | null;    // m/s (null si no se mueve)
  timestamp: number;
}

export type PositionState = 'starting' | 'tracking' | 'denied' | 'unavailable';

export function useDriverPosition(enabled: boolean = true) {
  const [position, setPosition] = useState<DriverPosition | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [state, setState] = useState<PositionState>('starting');

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (!('geolocation' in navigator)) {
      setState('unavailable');
      setError('Tu navegador no soporta geolocalización');
      return;
    }

    setState('starting');

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setState('tracking');
        setError(null);
        setPosition({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          heading: pos.coords.heading,
          speed: pos.coords.speed,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        const messages: Record<number, string> = {
          1: 'Permiso de ubicación denegado',
          2: 'No se pudo obtener tu ubicación (sin GPS / sin red)',
          3: 'Tiempo de espera agotado',
        };
        setError(messages[err.code] ?? 'Error de geolocalización');
        if (err.code === 1) setState('denied');
        else setState('unavailable');
      },
      {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 30_000,
      },
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [enabled]);

  return { position, error, state };
}
