'use client';

// Banner arriba del mapa con la próxima instrucción de navegación.
// Se muestra solo si hay un step actual con instrucción.
//
// Diseño minimalista para móvil con el chofer manejando:
//   - Icono grande del maneuver (gira derecha, izquierda, recto, etc.)
//   - Texto principal de la instrucción
//   - Distancia al maneuver en grande para lectura periférica

import type { NavStep } from '@/lib/mapbox';

interface Props {
  step: NavStep | null;
  distanceToManeuver: number | null;
  offRoute: boolean;
}

/** Mapping de modifier de Mapbox a emoji de flecha. */
const ARROW: Record<string, string> = {
  'turn-left': '↰',
  'turn-right': '↱',
  'sharp left': '↺',
  'sharp right': '↻',
  'slight left': '↖',
  'slight right': '↗',
  straight: '↑',
  uturn: '⤺',
};

function arrowFor(step: NavStep): string {
  const key = step.modifier ? `${step.type}-${step.modifier}`.replace(/\s+/g, '-') : step.type;
  if (ARROW[key]) return ARROW[key];
  // Fallback por modifier solo.
  if (step.modifier) {
    const m = step.modifier.toLowerCase();
    if (m.includes('left')) return '↰';
    if (m.includes('right')) return '↱';
  }
  if (step.type === 'arrive') return '🏁';
  if (step.type === 'depart') return '🚐';
  return '↑';
}

function formatDist(m: number | null): string {
  if (m == null) return '';
  if (m < 50) return 'ya';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  // ADR-125: el chofer NO ve km. Hasta 1500m mostramos en metros redondeados
  // (útil para anticipar la próxima maniobra). Más lejos devolvemos string
  // vacío — el chofer simplemente sigue derecho hasta que se acerque.
  if (m < 1500) return `${Math.round(m / 100) * 100} m`;
  return '';
}

export function TurnByTurnBanner({ step, distanceToManeuver, offRoute }: Props) {
  if (offRoute) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-warning-bg,#fef3c7)] px-4 py-3"
      >
        <span className="text-2xl">⚠️</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--color-text)]">
            Te desviaste de la ruta
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Recalculando…
          </p>
        </div>
      </div>
    );
  }

  if (!step) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-3 shadow-sm"
    >
      <span className="text-3xl leading-none" aria-hidden="true">
        {arrowFor(step)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-base font-semibold text-[var(--color-text)]">
          {step.instruction}
        </p>
        {/* ADR-125: si la distancia es > 1500m, formatDist devuelve '' y
            no renderemos el prefijo "En" — el chofer no necesita ese ruido. */}
        {distanceToManeuver != null && formatDist(distanceToManeuver) && (
          <p className="font-mono text-sm text-[var(--color-text-muted)]">
            En {formatDist(distanceToManeuver)}
          </p>
        )}
      </div>
    </div>
  );
}
