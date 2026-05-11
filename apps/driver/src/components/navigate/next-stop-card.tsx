'use client';

// Card flotante en el bottom de la pantalla de navegación.
// Muestra:
//   - Nombre y código de la próxima parada pendiente
//   - Distancia en vivo (calculada client-side con haversine)
//   - ETA aproximada (distancia / velocidad asumida 30 km/h en CDMX)
//   - Botón "Llegué" (siempre visible, manual)
//   - Si el chofer está a <100m → highlight verde + vibración + texto "Estás aquí"
//
// Sin red: la distancia se calcula localmente, NO depende de Mapbox. Funciona offline.

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button, Card } from '@tripdrive/ui';
import { haversineMeters } from '@tripdrive/utils';
import type { DriverPosition } from '@/lib/use-driver-position';
import type { NavigationStop } from './navigation-map';

const ARRIVAL_RADIUS_M = 100;
const ASSUMED_KMH = 30;

interface Props {
  nextStop: NavigationStop | null;
  driverPosition: DriverPosition | null;
  /** Si todas las paradas están done. */
  allDone: boolean;
}

export function NextStopCard({ nextStop, driverPosition, allDone }: Props) {
  const hasNotifiedRef = useRef<string | null>(null);

  // Vibración táctil cuando el chofer llega cerca de la próxima parada.
  // Solo vibra UNA VEZ por parada (memoiza el stopId).
  useEffect(() => {
    if (!nextStop || !driverPosition) return;
    const distance = haversineMeters(
      driverPosition.lat,
      driverPosition.lng,
      nextStop.lat,
      nextStop.lng,
    );
    if (distance <= ARRIVAL_RADIUS_M && hasNotifiedRef.current !== nextStop.stopId) {
      hasNotifiedRef.current = nextStop.stopId;
      // Vibración de 200ms — patrón "tap-tap" para llamar atención sin alarma.
      if ('vibrate' in navigator) {
        navigator.vibrate([200, 100, 200]);
      }
    }
  }, [nextStop, driverPosition]);

  if (allDone) {
    return (
      <Card className="m-3 border-[var(--color-border)] bg-[var(--vf-green-50,#f0fdf4)]">
        <h2 className="text-base font-semibold text-[var(--color-text)]">
          ¡Jornada completa!
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Visitaste todas las paradas. Regresa al CEDIS.
        </p>
      </Card>
    );
  }

  if (!nextStop) {
    return (
      <Card className="m-3 border-[var(--color-border)]">
        <p className="text-sm text-[var(--color-text-muted)]">Sin paradas pendientes.</p>
      </Card>
    );
  }

  const distance = driverPosition
    ? haversineMeters(driverPosition.lat, driverPosition.lng, nextStop.lat, nextStop.lng)
    : null;
  const isHere = distance != null && distance <= ARRIVAL_RADIUS_M;
  const distanceLabel = formatDistance(distance);
  const etaLabel = formatEta(distance);

  return (
    <Card
      className={`m-3 border-2 ${
        isHere
          ? 'border-[var(--vf-green-500,#16a34a)] bg-[var(--vf-green-50,#f0fdf4)]'
          : 'border-[var(--color-border)] bg-[var(--vf-surface-1)]'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
            {isHere ? '✅ Estás aquí' : `Próxima parada · #${nextStop.sequence}`}
          </p>
          <p className="mt-1 truncate text-base font-semibold text-[var(--color-text)]">
            {nextStop.storeName}
          </p>
          <p className="truncate text-xs text-[var(--color-text-muted)]">
            {nextStop.storeCode}
          </p>
        </div>
        <div className="text-right">
          {distanceLabel && (
            <p className="font-mono text-lg font-semibold text-[var(--color-text)]">
              {distanceLabel}
            </p>
          )}
          {etaLabel && (
            <p className="text-xs text-[var(--color-text-muted)]">{etaLabel}</p>
          )}
        </div>
      </div>

      <div className="mt-3">
        <Link href={`/route/stop/${nextStop.stopId}`} className="block">
          <Button
            type="button"
            variant={isHere ? 'primary' : 'secondary'}
            size="lg"
            className="w-full"
          >
            {isHere ? '✓ Iniciar entrega' : 'Ver detalles'}
          </Button>
        </Link>
        {!isHere && distance != null && (
          <p className="mt-2 text-center text-[11px] text-[var(--color-text-muted)]">
            Acércate a menos de 100 m para iniciar la entrega.
          </p>
        )}
      </div>
    </Card>
  );
}

function formatDistance(meters: number | null): string | null {
  if (meters == null) return null;
  if (meters < 50) return 'aquí';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatEta(meters: number | null): string | null {
  if (meters == null) return null;
  if (meters < 50) return null;
  // ETA aproximada con velocidad CDMX promedio.
  const seconds = (meters / 1000 / ASSUMED_KMH) * 3600;
  if (seconds < 60) return '<1 min';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `~${mins} min`;
  return `~${Math.floor(mins / 60)}h ${mins % 60}m`;
}
