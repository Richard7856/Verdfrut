// Banner superior de la pantalla de ruta del chofer.
// Muestra: nombre, fecha, status, ETA estimada, distancia total, contador de paradas completadas.

import type { Route } from '@tripdrive/types';
import { formatDateTimeInZone, formatDuration } from '@tripdrive/utils';
import { Badge } from '@tripdrive/ui';
import type { BadgeTone } from '@tripdrive/ui';

interface Props {
  route: Route;
  totalStops: number;
  completedStops: number;
  /** Timezone del tenant — viene de NEXT_PUBLIC_TENANT_TIMEZONE. */
  timezone: string;
}

const STATUS_LABEL: Record<Route['status'], { text: string; tone: BadgeTone }> = {
  DRAFT: { text: 'Borrador', tone: 'neutral' },
  OPTIMIZED: { text: 'Optimizada', tone: 'info' },
  APPROVED: { text: 'Aprobada', tone: 'info' },
  PUBLISHED: { text: 'Lista para iniciar', tone: 'primary' },
  IN_PROGRESS: { text: 'En progreso', tone: 'success' },
  INTERRUPTED: { text: 'Interrumpida', tone: 'danger' },
  COMPLETED: { text: 'Completada', tone: 'success' },
  CANCELLED: { text: 'Cancelada', tone: 'danger' },
};

export function RouteHeader({ route, totalStops, completedStops, timezone }: Props) {
  const status = STATUS_LABEL[route.status];
  const distanceKm =
    route.totalDistanceMeters != null
      ? new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(route.totalDistanceMeters / 1000)
      : null;
  const duration = route.totalDurationSeconds != null ? formatDuration(route.totalDurationSeconds) : null;
  const startEta = route.estimatedStartAt ? formatDateTimeInZone(route.estimatedStartAt, timezone) : null;
  const endEta = route.estimatedEndAt ? formatDateTimeInZone(route.estimatedEndAt, timezone) : null;

  return (
    <section className="border-b border-[var(--color-border)] bg-[var(--vf-surface-1)] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-[var(--color-text)]">{route.name}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">{formatDateLong(route.date)}</p>
        </div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-text-muted)]">
        <span>
          <strong className="text-[var(--color-text)]">{completedStops}/{totalStops}</strong> paradas
        </span>
        {distanceKm && (
          <span>
            <strong className="text-[var(--color-text)]">{distanceKm} km</strong>
          </span>
        )}
        {duration && (
          <span>
            <strong className="text-[var(--color-text)]">{duration}</strong> estimado
          </span>
        )}
        {startEta && endEta && (
          <span>
            {startEta} → {endEta}
          </span>
        )}
      </div>
    </section>
  );
}

/**
 * "lunes 5 de mayo" — formato largo en español sin año.
 * Si la fecha no es de este año, agregamos el año.
 */
function formatDateLong(yyyymmdd: string): string {
  const parts = yyyymmdd.split('-').map(Number);
  const [y, m, d] = parts as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const thisYear = new Date().getUTCFullYear();
  return new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: y !== thisYear ? 'numeric' : undefined,
    timeZone: 'UTC',
  }).format(date);
}
