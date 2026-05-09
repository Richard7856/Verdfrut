'use client';

// Card por ruta dentro del detalle del tiro. Muestra:
//  - Header con nombre + status + Kangoo + chofer + métricas (km, manejo, ETAs).
//  - Lista de paradas con flechas ↑↓ para reordenar dentro de la ruta + dropdown
//    "Mover a → otra ruta" del mismo tiro.
// ADR-025 + ADR-035 (reorder ↑↓) + ADR-043 (métricas detalladas).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, toast } from '@verdfrut/ui';
import { formatDuration } from '@verdfrut/utils';
import type { Route, RouteStatus, Stop, Store, Vehicle } from '@verdfrut/types';
import { moveStopToAnotherRouteAction } from '../actions';
import { reorderStopsAction } from '../../routes/actions';

const STATUS: Record<RouteStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
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
  dispatchId: string;
  route: Route;
  stops: Stop[];
  storesById: Map<string, Store>;
  vehicles: Vehicle[];
  /** Otras rutas del mismo tiro (para el dropdown "Mover a"). */
  siblings: Array<{ id: string; name: string; status: RouteStatus; vehicleId: string }>;
  /** Capacidad de cajas del vehículo (capacity[2]) — para warning visual. */
  capacityCajas: number;
  /** Timezone del tenant para formatear ETAs. */
  timezone?: string;
}

const EDITABLE_STATUSES = new Set<RouteStatus>(['DRAFT', 'OPTIMIZED', 'APPROVED']);
// ADR-035: post-publish también permite reorder de pending stops.
const REORDERABLE_STATUSES = new Set<RouteStatus>([
  'DRAFT',
  'OPTIMIZED',
  'APPROVED',
  'PUBLISHED',
  'IN_PROGRESS',
]);

export function RouteStopsCard({
  dispatchId,
  route,
  stops,
  storesById,
  vehicles,
  siblings,
  capacityCajas,
  timezone = 'America/Mexico_City',
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [movingStopId, setMovingStopId] = useState<string | null>(null);
  const [reorderingStopId, setReorderingStopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS[route.status];
  const vehicle = vehicles.find((v) => v.id === route.vehicleId);
  const editableSiblings = siblings.filter(
    (s) => s.id !== route.id && EDITABLE_STATUSES.has(s.status),
  );
  const canMove = EDITABLE_STATUSES.has(route.status) && editableSiblings.length > 0;
  const canReorder = REORDERABLE_STATUSES.has(route.status);
  const isPostPublish = route.status === 'PUBLISHED' || route.status === 'IN_PROGRESS';

  // ADR-043: total kg (sum de stop.load[0]) y count de pendientes vs total.
  const totalKg = stops.reduce((acc, s) => acc + (Number(s.load?.[0] ?? 0) || 0), 0);
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;
  const usedCajas = stops.length;
  const overCapacity = usedCajas > capacityCajas;

  // Sort stops por sequence — defensivo, server debe entregarlas ordenadas.
  const sortedStops = [...stops].sort((a, b) => a.sequence - b.sequence);

  function handleMove(stopId: string, targetRouteId: string) {
    setError(null);
    setMovingStopId(stopId);
    startTransition(async () => {
      const res = await moveStopToAnotherRouteAction(stopId, targetRouteId, dispatchId);
      setMovingStopId(null);
      if (!res.ok) {
        setError(res.error ?? 'Error');
        return;
      }
      router.refresh();
    });
  }

  function handleReorder(stopId: string, direction: 'up' | 'down') {
    setError(null);
    setReorderingStopId(stopId);
    // ADR-035: en post-publish solo paradas pending son reordenables.
    // Construimos el nuevo orden swappeando con la stop adyacente del mismo subset.
    const eligible = isPostPublish
      ? sortedStops.filter((s) => s.status === 'pending')
      : sortedStops;
    const idx = eligible.findIndex((s) => s.id === stopId);
    if (idx < 0) {
      setReorderingStopId(null);
      setError('Parada no movible');
      return;
    }
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= eligible.length) {
      setReorderingStopId(null);
      return;
    }
    const newEligible = [...eligible];
    [newEligible[idx], newEligible[swapWith]] = [newEligible[swapWith]!, newEligible[idx]!];

    // Server espera lista de IDs en el orden final. Para post-publish solo pending;
    // pre-publish, todas. reorderStopsAction maneja ambos casos.
    const idsToSend = isPostPublish
      ? newEligible.map((s) => s.id)
      : newEligible.map((s) => s.id);

    startTransition(async () => {
      const res = await reorderStopsAction(route.id, idsToSend);
      setReorderingStopId(null);
      if (!res.ok) {
        toast.error('No se pudo reordenar', res.error ?? '');
        return;
      }
      router.refresh();
    });
  }

  // Format helpers para ETAs en TZ del tenant.
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
          <Link
            href={`/routes/${route.id}`}
            className="block truncate text-sm font-semibold text-[var(--color-text)] hover:underline"
          >
            {route.name}
          </Link>
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">
            {vehicle?.alias ?? vehicle?.plate ?? '—'} ·{' '}
            <span className={overCapacity ? 'text-[var(--color-danger-fg)] font-semibold' : ''}>
              {usedCajas} paradas
            </span>
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
              Sale {fmtTime(route.estimatedStartAt)} · Regresa {fmtTime(route.estimatedEndAt)}
              {completedStops > 0 || skippedStops > 0
                ? ` · ${completedStops} ✓ ${skippedStops} omitidas`
                : ''}
            </p>
          )}
        </div>
        <Badge tone={status.tone}>{status.text}</Badge>
      </header>

      {overCapacity && (
        <p className="mt-2 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2 py-1 text-xs text-[var(--color-warning-fg)]">
          ⚠️ La ruta excede la capacidad del vehículo. Re-optimiza o mueve paradas.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger-fg)]">{error}</p>
      )}

      {sortedStops.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Sin paradas. Optimiza esta ruta o vincula una existente.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {sortedStops.map((s, idx) => {
            const store = storesById.get(s.storeId);
            const isMoving = movingStopId === s.id && pending;
            const isReorderingThis = reorderingStopId === s.id && pending;
            // Restricción ADR-035: en post-publish solo pending es reordenable.
            const isPending = s.status === 'pending';
            const eligibleStops = isPostPublish
              ? sortedStops.filter((x) => x.status === 'pending')
              : sortedStops;
            const eligibleIdx = eligibleStops.findIndex((x) => x.id === s.id);
            const canMoveUp =
              canReorder && (!isPostPublish || isPending) && eligibleIdx > 0;
            const canMoveDown =
              canReorder &&
              (!isPostPublish || isPending) &&
              eligibleIdx >= 0 &&
              eligibleIdx < eligibleStops.length - 1;

            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-2 py-1.5"
              >
                <div className="flex items-center gap-1">
                  {canReorder && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => handleReorder(s.id, 'up')}
                        disabled={!canMoveUp || isReorderingThis}
                        aria-label="Mover arriba"
                        title="Mover arriba"
                        className="grid h-3.5 w-5 place-items-center text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-20"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => handleReorder(s.id, 'down')}
                        disabled={!canMoveDown || isReorderingThis}
                        aria-label="Mover abajo"
                        title="Mover abajo"
                        className="grid h-3.5 w-5 place-items-center text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-20"
                      >
                        ▼
                      </button>
                    </div>
                  )}
                  <div className="min-w-0">
                    <span className="mr-2 text-xs font-mono text-[var(--color-text-muted)]">
                      #{s.sequence}
                    </span>
                    <span className="text-xs text-[var(--color-text)]">
                      {store?.code ?? '—'} {store?.name ?? '???'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {s.plannedArrivalAt && (
                    <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-subtle)]">
                      {fmtTime(s.plannedArrivalAt)}
                    </span>
                  )}
                  {canMove && s.status === 'pending' && (
                    <MoveStopMenu
                      siblings={editableSiblings}
                      vehicles={vehicles}
                      disabled={isMoving}
                      onMove={(targetId) => handleMove(s.id, targetId)}
                    />
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

function MoveStopMenu({
  siblings,
  vehicles,
  disabled,
  onMove,
}: {
  siblings: Array<{ id: string; name: string; vehicleId: string }>;
  vehicles: Vehicle[];
  disabled: boolean;
  onMove: (targetRouteId: string) => void;
}) {
  return (
    <select
      defaultValue=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        onMove(v);
        e.target.value = '';
      }}
      disabled={disabled}
      className="rounded border border-[var(--color-border)] bg-[var(--vf-surface-1)] px-1.5 py-0.5 text-[11px] text-[var(--color-text)] disabled:opacity-50"
      aria-label="Mover parada a otra ruta"
    >
      <option value="">Mover a →</option>
      {siblings.map((s) => {
        const v = vehicles.find((veh) => veh.id === s.vehicleId);
        return (
          <option key={s.id} value={s.id}>
            {v?.alias ?? v?.plate ?? s.name}
          </option>
        );
      })}
    </select>
  );
}
