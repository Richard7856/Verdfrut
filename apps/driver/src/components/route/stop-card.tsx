'use client';

// Tarjeta de una parada en la lista del chofer.
// Muestra: orden, código de tienda, nombre, dirección, ETA planeada, status badge.
// Click → navegar a /route/stop/[id].
// Es Client Component porque el <a tel:...> usa onClick para stopPropagation
// y evitar que el click en "llamar tienda" navegue al detalle de la parada.

import Link from 'next/link';
import { Badge, type BadgeTone } from '@verdfrut/ui';
import { formatTimeInZone } from '@verdfrut/utils';
import type { StopWithStore } from '@/lib/queries/route';

interface Props {
  item: StopWithStore;
  /** Si TRUE, esta es la próxima parada pendiente — se enfatiza visualmente. */
  isNext: boolean;
  timezone: string;
}

const STATUS_LABEL: Record<StopWithStore['stop']['status'], { text: string; tone: BadgeTone }> = {
  pending: { text: 'Pendiente', tone: 'neutral' },
  arrived: { text: 'En tienda', tone: 'info' },
  completed: { text: 'Entregada', tone: 'success' },
  skipped: { text: 'Omitida', tone: 'danger' },
};

export function StopCard({ item, isNext, timezone }: Props) {
  const { stop, store } = item;
  const status = STATUS_LABEL[stop.status];
  const eta = stop.plannedArrivalAt ? formatTimeInZone(stop.plannedArrivalAt, timezone) : null;
  const isDone = stop.status === 'completed' || stop.status === 'skipped';

  return (
    <Link
      href={`/route/stop/${stop.id}`}
      className={[
        'block rounded-[var(--radius-lg)] border bg-[var(--vf-surface-1)] p-4 transition-colors',
        'hover:bg-[var(--vf-surface-2)] active:bg-[var(--vf-surface-2)]',
        isNext
          ? 'border-[var(--vf-green-500)] shadow-[0_0_0_1px_var(--vf-green-500)]'
          : 'border-[var(--color-border)]',
        isDone ? 'opacity-60' : '',
      ].join(' ')}
    >
      <div className="flex items-start gap-3">
        <div
          className={[
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
            isNext
              ? 'bg-[var(--vf-green-500)] text-white'
              : 'bg-[var(--vf-surface-2)] text-[var(--color-text)]',
          ].join(' ')}
          aria-label={`Parada ${stop.sequence}`}
        >
          {stop.sequence}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--color-text)]">
                <span className="text-[var(--color-text-muted)]">{store.code}</span> · {store.name}
              </p>
              <p className="truncate text-xs text-[var(--color-text-muted)]">{store.address}</p>
            </div>
            <Badge tone={status.tone}>{status.text}</Badge>
          </div>

          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-[var(--color-text-muted)]">
            {eta && <span>ETA {eta}</span>}
            {store.contactPhone && (
              <span>
                Tel{' '}
                <a
                  href={`tel:${store.contactPhone}`}
                  className="underline-offset-2 hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  {store.contactPhone}
                </a>
              </span>
            )}
            {store.receivingWindowStart && store.receivingWindowEnd && (
              <span>
                Recibe {store.receivingWindowStart}–{store.receivingWindowEnd}
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
