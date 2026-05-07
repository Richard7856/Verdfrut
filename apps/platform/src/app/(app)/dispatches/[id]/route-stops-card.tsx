'use client';

// Card por ruta dentro del detalle del tiro. Muestra:
//  - Header con nombre + status + Kangoo + chofer.
//  - Lista de paradas con cada una con dropdown "Mover a → otra ruta".
// ADR-025.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Badge, Card, Button } from '@verdfrut/ui';
import type { Route, RouteStatus, Stop, Store, Vehicle } from '@verdfrut/types';
import { moveStopToAnotherRouteAction } from '../actions';

const STATUS: Record<RouteStatus, { text: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }> = {
  DRAFT: { text: 'Borrador', tone: 'neutral' },
  OPTIMIZED: { text: 'Optimizada', tone: 'info' },
  APPROVED: { text: 'Aprobada', tone: 'info' },
  PUBLISHED: { text: 'Publicada', tone: 'info' },
  IN_PROGRESS: { text: 'En curso', tone: 'success' },
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
}

const EDITABLE_STATUSES = new Set<RouteStatus>(['DRAFT', 'OPTIMIZED', 'APPROVED']);

export function RouteStopsCard({
  dispatchId,
  route,
  stops,
  storesById,
  vehicles,
  siblings,
  capacityCajas,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [movingStopId, setMovingStopId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS[route.status];
  const vehicle = vehicles.find((v) => v.id === route.vehicleId);
  const editableSiblings = siblings.filter(
    (s) => s.id !== route.id && EDITABLE_STATUSES.has(s.status),
  );
  const canMove = EDITABLE_STATUSES.has(route.status) && editableSiblings.length > 0;

  // Capacidad usada (cuenta de stops en estado pending — V1 simplista, no suma demand).
  const usedCajas = stops.length;
  const overCapacity = usedCajas > capacityCajas;

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
              {usedCajas}/{capacityCajas} cajas
            </span>
            {route.totalDistanceMeters
              ? ` · ${(route.totalDistanceMeters / 1000).toFixed(1)} km`
              : ''}
          </p>
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

      {stops.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Sin paradas. Optimiza esta ruta o vincula una existente.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-1.5">
          {stops.map((s) => {
            const store = storesById.get(s.storeId);
            const isMoving = movingStopId === s.id && pending;
            return (
              <li
                key={s.id}
                className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-2 py-1.5"
              >
                <div className="min-w-0 flex-1">
                  <span className="mr-2 text-xs font-mono text-[var(--color-text-muted)]">
                    #{s.sequence}
                  </span>
                  <span className="text-xs text-[var(--color-text)]">
                    {store?.code ?? '—'} {store?.name ?? '???'}
                  </span>
                </div>
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

// Tipos auxiliares no usados directamente — silencia warning si TS lo flagea.
void undefined;
