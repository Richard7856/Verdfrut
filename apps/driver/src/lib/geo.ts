'use client';

// Helpers de geo para validación de cercanía a tienda al iniciar reportes.
// El chofer DEBE estar cerca de la tienda para registrar arrival con el tipo
// correcto. Sin esto, un chofer puede reportar "tienda cerrada" desde su casa
// y cobrar la jornada sin haber salido.

import { haversineMeters } from '@tripdrive/utils';

/** Coords del chofer obtenidas del browser. */
export interface DriverCoords {
  lat: number;
  lng: number;
  accuracy: number; // metros — útil para decidir si la lectura es confiable
  timestamp: number;
}

export interface CoordsError {
  code: 'denied' | 'unavailable' | 'timeout' | 'unsupported';
  message: string;
}

/**
 * Pide la posición actual del chofer una sola vez (no watchPosition).
 * Usar para el momento de arrival — el GPS broadcast continuo viene aparte.
 */
export function getCurrentDriverCoords(): Promise<DriverCoords | CoordsError> {
  if (typeof window === 'undefined' || !('geolocation' in navigator)) {
    return Promise.resolve({ code: 'unsupported', message: 'Browser sin geolocalización' });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
      },
      (err) => {
        const codeMap: Record<number, CoordsError['code']> = {
          1: 'denied',
          2: 'unavailable',
          3: 'timeout',
        };
        const messages: Record<number, string> = {
          1: 'Permiso de ubicación denegado',
          2: 'No se pudo obtener tu ubicación',
          3: 'Tiempo de espera agotado al pedir GPS',
        };
        resolve({
          code: codeMap[err.code] ?? 'unavailable',
          message: messages[err.code] ?? 'Error de geolocalización',
        });
      },
      {
        enableHighAccuracy: true,
        maximumAge: 30_000, // aceptar lectura cacheada de hasta 30s
        timeout: 15_000,
      },
    );
  });
}

export function isCoordsError(x: DriverCoords | CoordsError): x is CoordsError {
  return 'code' in x;
}

/**
 * Calcula distancia entre chofer y tienda y devuelve si está dentro del umbral.
 * Mismo cálculo que el server hace al validar — duplicamos en cliente para
 * dar feedback inmediato sin round-trip.
 */
export function isWithinStore(
  driver: DriverCoords,
  store: { lat: number; lng: number },
  thresholdMeters: number,
): { ok: boolean; distance: number } {
  const distance = haversineMeters(driver.lat, driver.lng, store.lat, store.lng);
  return { ok: distance <= thresholdMeters, distance };
}
