'use client';

// Componente cliente que orquesta la pantalla de navegación con turn-by-turn:
//   - Polyline planeada (server-side) como base.
//   - Cuando llega GPS del chofer → fetch dynamic polyline desde su posición
//     a la próxima parada CON steps + voiceInstructions.
//   - useTurnByTurn sigue qué step está activo y cuándo anunciar.
//   - useSpeech usa Web Speech API para leer instrucciones en español.
//   - Si el chofer se sale >50m de la ruta, se auto-recalcula la polyline.
//   - Toggle de voz en el header (persist localStorage).

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { haversineMeters } from '@tripdrive/utils';
import { useDriverPosition } from '@/lib/use-driver-position';
import { useTurnByTurn } from '@/lib/use-turn-by-turn';
import { useSpeech } from '@/lib/use-speech';
import type { NavStep } from '@/lib/mapbox';
import { NavigationMap, type NavigationStop, type NavigationDepot } from './navigation-map';
import { NextStopCard } from './next-stop-card';
import { TurnByTurnBanner } from './turn-by-turn-banner';

interface Props {
  routeId: string;
  stops: NavigationStop[];
  depot: NavigationDepot | null;
  geometry: GeoJSON.LineString | null;
  mapboxToken: string;
}

const RECALC_DISTANCE_M = 500;

export function NavigationClient({ routeId, stops, depot, geometry: initialGeometry, mapboxToken }: Props) {
  void routeId;
  const { position, error, state } = useDriverPosition(true);
  const { speak, toggle: toggleMute, muted, available: ttsAvailable } = useSpeech();

  const [dynamicGeometry, setDynamicGeometry] = useState<GeoJSON.LineString | null>(null);
  const [steps, setSteps] = useState<NavStep[]>([]);
  const lastFetchedAtRef = useRef<{ lat: number; lng: number; stopId: string } | null>(null);
  // Cooldown del recalc disparado por off-route: evita loop "Recalculando" cuando
  // el GPS tiene accuracy variable y el chofer queda apenas dentro/fuera del threshold.
  // Sin esto, cada flap del offRoute (false→true→false→true) dispara un fetch nuevo.
  const lastRecalcAtRef = useRef(0);
  const RECALC_COOLDOWN_MS = 30_000;

  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const nextStop = sorted.find((s) => s.status === 'pending') ?? null;
  const allDone =
    sorted.length > 0 && sorted.every((s) => s.status !== 'pending' && s.status !== 'arrived');

  // Turn-by-turn — pasa speak como callback de anuncio.
  const onAnnounce = useCallback((text: string) => speak(text), [speak]);
  const { currentStep, distanceToManeuver, offRoute } = useTurnByTurn(
    steps,
    position,
    onAnnounce,
  );

  // Función para hacer el fetch — se llama desde varios efectos.
  const recalcRef = useRef<() => void>(() => {});
  recalcRef.current = () => {
    if (!position || !nextStop) return;
    fetch('/api/route/dynamic-polyline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { lat: position.lat, lng: position.lng },
        toStopId: nextStop.stopId,
      }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (data: {
          geometry?: GeoJSON.LineString | null;
          steps?: NavStep[];
        } | null) => {
          if (data?.geometry) setDynamicGeometry(data.geometry);
          if (data?.steps) setSteps(data.steps);
          if (position && nextStop) {
            lastFetchedAtRef.current = {
              lat: position.lat,
              lng: position.lng,
              stopId: nextStop.stopId,
            };
          }
        },
      )
      .catch((err) => console.error('[dynamic-polyline]', err));
  };

  // Disparar recalc según GPS + cambio de stop + movimiento >500m.
  useEffect(() => {
    if (!position || !nextStop) return;
    const last = lastFetchedAtRef.current;
    const stopChanged = last?.stopId !== nextStop.stopId;
    const movedFar =
      last && haversineMeters(position.lat, position.lng, last.lat, last.lng) > RECALC_DISTANCE_M;
    if (last && !stopChanged && !movedFar) return;
    recalcRef.current();
  }, [position, nextStop]);

  // Off-route → recalcular + anunciar (con cooldown anti-loop).
  useEffect(() => {
    if (!offRoute) return;
    const now = Date.now();
    if (now - lastRecalcAtRef.current < RECALC_COOLDOWN_MS) {
      // Reciente, ignorar este off-route. El usuario ya recibió un recalc hace <30s.
      return;
    }
    lastRecalcAtRef.current = now;
    speak('Recalculando ruta');
    recalcRef.current();
  }, [offRoute, speak]);

  const displayGeometry = dynamicGeometry ?? initialGeometry;

  return (
    <div className="flex h-dvh flex-col bg-[var(--vf-bg)]">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-2 safe-top">
        <Link
          href="/route"
          aria-label="Volver a lista"
          className="text-2xl text-[var(--color-text-muted)]"
        >
          ←
        </Link>
        <p className="flex-1 truncate text-center text-sm font-medium text-[var(--color-text)]">
          Navegación
        </p>
        <div className="flex items-center gap-3">
          {ttsAvailable && (
            <button
              type="button"
              onClick={toggleMute}
              className="text-lg"
              aria-label={muted ? 'Activar voz' : 'Silenciar voz'}
              title={muted ? 'Activar voz' : 'Silenciar voz'}
            >
              {muted ? '🔇' : '🔊'}
            </button>
          )}
          <span
            className="text-xs"
            style={{
              color:
                state === 'tracking'
                  ? 'var(--vf-green-600,#15803d)'
                  : state === 'denied'
                    ? 'var(--color-danger-fg)'
                    : 'var(--color-text-muted)',
            }}
          >
            {state === 'tracking' ? '● GPS' : state === 'denied' ? '✕ Sin GPS' : '◌ GPS'}
          </span>
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--color-danger-bg)] px-4 py-2 text-xs text-[var(--color-danger-fg)]">
          {error}. Activa el GPS en tu teléfono y permite el acceso al sitio.
        </div>
      )}

      <TurnByTurnBanner
        step={currentStep}
        distanceToManeuver={distanceToManeuver}
        offRoute={offRoute}
      />

      <div className="relative flex-1 overflow-hidden">
        <NavigationMap
          stops={stops}
          depot={depot}
          geometry={displayGeometry}
          driverPosition={position}
          nextStopId={nextStop?.stopId ?? null}
          mapboxToken={mapboxToken}
          className="h-full w-full"
        />
      </div>

      <div className="shrink-0 safe-bottom">
        <NextStopCard nextStop={nextStop} driverPosition={position} allDone={allDone} />
      </div>
    </div>
  );
}
