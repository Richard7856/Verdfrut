'use client';

// Card por ruta dentro del detalle del tiro. Muestra:
//  - Header con nombre + status + Kangoo + chofer + métricas (km, manejo, ETAs).
//  - Lista de paradas con drag-and-drop para reordenar dentro de la ruta + dropdown
//    "Mover a → otra ruta" del mismo tiro.
// ADR-025 + ADR-035 (reorder) + ADR-043 (métricas) + ADR-045 (drag-drop).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Card, toast } from '@verdfrut/ui';
import { formatDuration } from '@verdfrut/utils';
import type { Route, RouteStatus, Stop, Store, Vehicle } from '@verdfrut/types';
import { moveStopToAnotherRouteAction } from '../actions';
import { reorderStopsAction } from '../../routes/actions';
import { RemoveVehicleButton } from './remove-vehicle-button';

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

interface StopRowData {
  stop: Stop;
  storeCode: string;
  storeName: string;
}

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
  const [error, setError] = useState<string | null>(null);

  const status = STATUS[route.status];
  const vehicle = vehicles.find((v) => v.id === route.vehicleId);
  const editableSiblings = siblings.filter(
    (s) => s.id !== route.id && EDITABLE_STATUSES.has(s.status),
  );
  const canMove = EDITABLE_STATUSES.has(route.status) && editableSiblings.length > 0;
  const canReorder = REORDERABLE_STATUSES.has(route.status);
  const isPostPublish = route.status === 'PUBLISHED' || route.status === 'IN_PROGRESS';

  // ADR-043: total kg + completados/omitidos
  const totalKg = stops.reduce((acc, s) => acc + (Number(s.load?.[0] ?? 0) || 0), 0);
  const completedStops = stops.filter((s) => s.status === 'completed').length;
  const skippedStops = stops.filter((s) => s.status === 'skipped').length;
  const usedCajas = stops.length;
  const overCapacity = usedCajas > capacityCajas;

  // Ordered stops + estado local para optimistic UI
  const sorted = [...stops].sort((a, b) => a.sequence - b.sequence);
  const initialItems: StopRowData[] = sorted.map((s) => ({
    stop: s,
    storeCode: storesById.get(s.storeId)?.code ?? '—',
    storeName: storesById.get(s.storeId)?.name ?? '???',
  }));

  // ADR-045: drag-and-drop con dnd-kit. Reordena con arrayMove(items, oldIdx, newIdx)
  // — al soltar la parada en la posición N, todas las que estaban entre N y la
  // antigua posición se desplazan automáticamente. Es el comportamiento que
  // pidió el cliente (vs ↑↓ uno por uno).
  const [items, setItems] = useState<StopRowData[]>(initialItems);
  const [dirty, setDirty] = useState(false);

  // Sync local state if upstream stops cambia (después de router.refresh).
  // Heurística: si los IDs cambiaron O el length, reset.
  if (
    !dirty &&
    (items.length !== initialItems.length ||
      items.some((it, i) => it.stop.id !== initialItems[i]?.stop.id))
  ) {
    setItems(initialItems);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((s) => s.stop.id === active.id);
    const newIdx = items.findIndex((s) => s.stop.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    // Post-publish: solo paradas pending son movibles. Si origen o destino no
    // son pending, abortar con toast claro.
    if (isPostPublish) {
      const dragStatus = items[oldIdx]?.stop.status;
      const targetStatus = items[newIdx]?.stop.status;
      if (dragStatus !== 'pending' || targetStatus !== 'pending') {
        toast.error(
          'Solo paradas pendientes se pueden mover',
          'Las paradas completadas/omitidas/en sitio quedan fijas en su posición original.',
        );
        return;
      }
    }

    // arrayMove: pone el item en newIdx, las demás se desplazan.
    // Ej: items [A,B,C,D,E,F,G] con G→2 = [A,B,G,C,D,E,F]
    const reordered = arrayMove(items, oldIdx, newIdx).map((it, i) => ({
      ...it,
      stop: { ...it.stop, sequence: i + 1 },
    }));
    setItems(reordered);
    setDirty(true);

    // Persistir en server. ADR-035: en post-publish solo enviamos IDs de pending.
    const idsToSend = isPostPublish
      ? reordered.filter((it) => it.stop.status === 'pending').map((it) => it.stop.id)
      : reordered.map((it) => it.stop.id);

    startTransition(async () => {
      const res = await reorderStopsAction(route.id, idsToSend);
      if (!res.ok) {
        toast.error('No se pudo reordenar', res.error ?? '');
        // Rollback al orden original.
        setItems(initialItems);
        setDirty(false);
        return;
      }
      // Server ya recalculó ETAs/km (ADR-044). Refresh para tomar valores nuevos.
      setDirty(false);
      router.refresh();
    });
  }

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

  // Format helpers
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
        <div className="flex flex-col items-end gap-1">
          <Badge tone={status.tone}>{status.text}</Badge>
          {/* ADR-048: quitar camioneta — solo en pre-publicación. */}
          {EDITABLE_STATUSES.has(route.status) && (
            <RemoveVehicleButton
              routeId={route.id}
              vehicleLabel={vehicle?.alias ?? vehicle?.plate ?? 'la ruta'}
              remainingAfter={
                siblings.filter((s) => s.id !== route.id && s.status !== 'CANCELLED').length
              }
              stopsCount={items.length}
            />
          )}
        </div>
      </header>

      {overCapacity && (
        <p className="mt-2 rounded border border-[var(--color-warning-border)] bg-[var(--color-warning-bg)] px-2 py-1 text-xs text-[var(--color-warning-fg)]">
          ⚠️ La ruta excede la capacidad del vehículo. Re-optimiza o mueve paradas.
        </p>
      )}

      {error && (
        <p className="mt-2 text-xs text-[var(--color-danger-fg)]">{error}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
          Sin paradas. Optimiza esta ruta o vincula una existente.
        </p>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={canReorder ? handleDragEnd : undefined}
        >
          <SortableContext
            items={items.map((it) => it.stop.id)}
            strategy={verticalListSortingStrategy}
          >
            <ul className="mt-3 flex flex-col gap-1.5">
              {items.map((item) => {
                const isMoving = movingStopId === item.stop.id && pending;
                const isPending = item.stop.status === 'pending';
                const rowDraggable =
                  canReorder && !pending && (!isPostPublish || isPending);
                return (
                  <SortableStopRow
                    key={item.stop.id}
                    item={item}
                    draggable={rowDraggable}
                    canMoveBetweenRoutes={canMove && isPending}
                    isPostPublishDimmed={isPostPublish && !isPending}
                    isMovingBetweenRoutes={isMoving}
                    siblings={editableSiblings}
                    vehicles={vehicles}
                    fmtTime={fmtTime}
                    onMove={(targetId) => handleMove(item.stop.id, targetId)}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      )}
    </Card>
  );
}

function SortableStopRow({
  item,
  draggable,
  canMoveBetweenRoutes,
  isPostPublishDimmed,
  isMovingBetweenRoutes,
  siblings,
  vehicles,
  fmtTime,
  onMove,
}: {
  item: StopRowData;
  draggable: boolean;
  canMoveBetweenRoutes: boolean;
  isPostPublishDimmed: boolean;
  isMovingBetweenRoutes: boolean;
  siblings: Array<{ id: string; name: string; vehicleId: string }>;
  vehicles: Vehicle[];
  fmtTime: (iso: string | null) => string;
  onMove: (targetRouteId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.stop.id, disabled: !draggable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : isPostPublishDimmed ? 0.6 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--vf-surface-2)] px-2 py-1.5"
    >
      <div className="flex items-center gap-1.5">
        {draggable && (
          <span
            {...attributes}
            {...listeners}
            aria-label="Arrastra para reordenar"
            className="select-none px-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            style={{ cursor: 'grab', fontFamily: 'system-ui' }}
            title="Arrastra para reordenar"
          >
            ⋮⋮
          </span>
        )}
        <span className="text-xs font-mono text-[var(--color-text-muted)]">
          #{item.stop.sequence}
        </span>
        <span className="text-xs text-[var(--color-text)]">
          {item.storeCode} {item.storeName}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {item.stop.plannedArrivalAt && (
          <span className="text-[10px] font-mono tabular-nums text-[var(--color-text-subtle)]">
            {fmtTime(item.stop.plannedArrivalAt)}
          </span>
        )}
        {canMoveBetweenRoutes && (
          <MoveStopMenu
            siblings={siblings}
            vehicles={vehicles}
            disabled={isMovingBetweenRoutes}
            onMove={onMove}
          />
        )}
        {item.stop.status !== 'pending' && (
          <span className="text-[10px] uppercase tracking-wide text-[var(--color-text-subtle)]">
            {item.stop.status}
          </span>
        )}
      </div>
    </li>
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
      // Los listeners de dnd-kit absorben pointerdown — bloqueamos para que el
      // select sí reciba clicks normales y no inicie un drag por accidente.
      onPointerDown={(e) => e.stopPropagation()}
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
