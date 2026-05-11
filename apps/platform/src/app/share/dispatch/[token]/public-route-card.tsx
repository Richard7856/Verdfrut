// ADR-046: card read-only de cada ruta para la vista pública. Sin drag, sin
// dropdowns, sin botones de mover. Solo info.

import { Badge, Card, type BadgeTone } from '@tripdrive/ui';
import { formatDuration } from '@tripdrive/utils';
import type { Route, RouteStatus, Stop, Store, Vehicle } from '@tripdrive/types';

const STATUS: Record<RouteStatus, { text: string; tone: BadgeTone }> = {
  DRAFT: { text: 'Borrador', tone: 'neutral' },
  OPTIMIZED: { text: 'Optimizada', tone: 'info' },
  APPROVED: { text: 'Aprobada', tone: 'info' },
  PUBLISHED: { text: 'Publicada', tone: 'info' },
  IN_PROGRESS: { text: 'En curso', tone: 'success' },
  INTERRUPTED: { text: 'Interrumpida', tone: 'danger' },
  COMPLETED: { text: 'Completada', tone: 'success' },
  CANCELLED: { text: 'Cancelada', tone: 'danger' },
};

interface Props {
  route: Route;
  stops: Stop[];
  storesById: Map<string, Store>;
  vehicle: Vehicle | undefined;
  timezone?: string;
}

export function PublicRouteCard({
  route,
  stops,
  storesById,
  vehicle,
  timezone = 'America/Mexico_City',
}: Props) {
  const status = STATUS[route.status];
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);
  const totalKg = stops.reduce((acc, s) => acc + (Number(s.load?.[0] ?? 0) || 0), 0);
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;

  const fmtTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat('es-MX', {
          timeZone: timezone,
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(new Date(iso))
      : '—';

  return (
    <Card className="border-[var(--color-border)]">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-[var(--color-text)]">
            {route.name}
          </span>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {vehicle?.alias ?? vehicle?.plate ?? '—'} · {stops.length} paradas
            {totalKg > 0 ? ` · ${totalKg} kg` : ''}
            {route.totalDistanceMeters
              ? ` · ${(route.totalDistanceMeters / 1000).toFixed(1)} km`
              : ''}
            {route.totalDurationSeconds
              ? ` · ${formatDuration(route.totalDurationSeconds)} manejo`
              : ''}
          </p>
          {route.estimatedStartAt && route.estimatedEndAt && (
            <p className="mt-0.5 text-[11px] text-[var(--color-text-subtle)]">
              Sale {fmtTime(route.estimatedStartAt)} · Regresa{' '}
              {fmtTime(route.estimatedEndAt)}
              {completedStops > 0 || skippedStops > 0
                ? ` · ${completedStops} ✓ ${skippedStops} omitidas`
                : ''}
            </p>
          )}
        </div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </header>

      {sortedStops.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">Sin paradas.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {sortedStops.map((s) => {
            const store = storesById.get(s.storeId);
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-2 py-1.5"
              >
                <div className="min-w-0">
                  <span className="mr-2 text-xs font-mono text-[var(--color-text-muted)]">
                    #{s.sequence}
                  </span>
                  <span className="text-xs text-[var(--color-text)]">
                    {store?.code ?? '—'} {store?.name ?? '???'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {s.plannedArrivalAt && (
                    <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-subtle)]">
                      {fmtTime(s.plannedArrivalAt)}
                    </span>
                  )}
                  {s.status !== 'pending' && (
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-subtle)]">
                      {s.status}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
