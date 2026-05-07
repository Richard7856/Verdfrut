'use client';

// Hook que sigue los steps de navegación en tiempo real:
//   1. Recibe la lista de steps (de Mapbox) + posición actual del chofer.
//   2. Calcula cuál es el step ACTUAL (el más cercano a la posición).
//   3. Calcula la distancia restante al maneuver del step actual.
//   4. Cuando se anuncia (voiceInstructions[i].distanceAlongGeometry) se cumple,
//      dispara el TTS de esa instrucción una sola vez.
//   5. Detecta off-route: si el chofer está a >50m del polyline durante
//      varios updates, marca offRoute=true para que el caller pida recálculo.

import { useEffect, useMemo, useRef, useState } from 'react';
import { haversineMeters } from '@verdfrut/utils';
import type { NavStep } from './mapbox';
import type { DriverPosition } from './use-driver-position';

// 100m de tolerancia (GPS típico tiene 10-50m de accuracy, mejor margen).
// 5 updates consecutivos en lugar de 3 (menos sensible a glitches).
// Estos valores se calibraron para evitar el loop "Recalculando" que pasaba
// con 50m + 3 updates en condiciones reales (ciudad con accuracy 20-40m).
const OFF_ROUTE_THRESHOLD_M = 100;
const OFF_ROUTE_CONSECUTIVE = 5;

export interface TurnByTurnState {
  /** Index del step actual en el array recibido. */
  currentStepIndex: number;
  /** Step actual o null si no hay steps. */
  currentStep: NavStep | null;
  /** Distancia restante hasta el maneuver del step actual (metros). */
  distanceToManeuver: number | null;
  /** True si el chofer se desvió >50m de la ruta planeada. */
  offRoute: boolean;
}

export function useTurnByTurn(
  steps: NavStep[],
  driverPosition: DriverPosition | null,
  /** Callback para anunciar un voice instruction (fed externally al TTS). */
  onAnnounce: (text: string) => void,
): TurnByTurnState {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToManeuver, setDistanceToManeuver] = useState<number | null>(null);
  const [offRoute, setOffRoute] = useState(false);

  const announcedSetRef = useRef<Set<string>>(new Set());
  const offRouteCountRef = useRef(0);

  // Reset cuando cambia la lista de steps (nueva ruta calculada).
  useEffect(() => {
    setCurrentStepIndex(0);
    setDistanceToManeuver(null);
    setOffRoute(false);
    announcedSetRef.current.clear();
    offRouteCountRef.current = 0;
  }, [steps]);

  useEffect(() => {
    if (!driverPosition || steps.length === 0) return;
    const step = steps[currentStepIndex];
    if (!step) return;

    // Distancia del chofer al PUNTO DE MANEUVER del step actual.
    const distToManeuver = haversineMeters(
      driverPosition.lat,
      driverPosition.lng,
      step.location[1],
      step.location[0],
    );
    setDistanceToManeuver(distToManeuver);

    // Avance al siguiente step: si pasamos el maneuver actual (<30m) → next.
    if (distToManeuver < 30 && currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((i) => i + 1);
      return;
    }

    // Voice instructions del step actual — dispararlas según
    // distanceAlongGeometry. Mapbox las da en orden (200m antes, 50m antes, en).
    if (step.voiceInstructions) {
      // distanceAlongGeometry mide cuánto del step ya pasó. Como el step
      // empieza al final del anterior, podemos aproximar usando distToManeuver
      // (lo que falta) restado de la longitud del step.
      const passedAlongStep = step.distance - distToManeuver;
      for (const v of step.voiceInstructions) {
        const key = `${currentStepIndex}-${v.distanceAlongGeometry}`;
        if (announcedSetRef.current.has(key)) continue;
        if (passedAlongStep >= v.distanceAlongGeometry) {
          announcedSetRef.current.add(key);
          onAnnounce(v.announcement);
        }
      }
    }

    // Off-route detection: distancia del chofer al polyline del step actual.
    if (step.geometry) {
      const minDist = minDistanceToPolyline(
        driverPosition.lat,
        driverPosition.lng,
        step.geometry.coordinates,
      );
      if (minDist > OFF_ROUTE_THRESHOLD_M) {
        offRouteCountRef.current += 1;
        if (offRouteCountRef.current >= OFF_ROUTE_CONSECUTIVE) {
          setOffRoute(true);
        }
      } else {
        offRouteCountRef.current = 0;
        if (offRoute) setOffRoute(false);
      }
    }
  }, [driverPosition, steps, currentStepIndex, onAnnounce, offRoute]);

  return useMemo(
    () => ({
      currentStepIndex,
      currentStep: steps[currentStepIndex] ?? null,
      distanceToManeuver,
      offRoute,
    }),
    [currentStepIndex, steps, distanceToManeuver, offRoute],
  );
}

/**
 * Distancia mínima de un punto a una polyline (aproximación: distancia al
 * vértice más cercano). Suficiente para detectar off-route a esta escala.
 * Para precisión 100% habría que calcular distancia al SEGMENTO, no al vértice.
 */
function minDistanceToPolyline(
  lat: number,
  lng: number,
  coords: number[][],
): number {
  let min = Infinity;
  for (const c of coords) {
    if (c.length < 2) continue;
    const d = haversineMeters(lat, lng, c[1]!, c[0]!);
    if (d < min) min = d;
  }
  return min;
}
