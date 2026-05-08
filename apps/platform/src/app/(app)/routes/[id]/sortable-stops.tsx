'use client';

// Lista de paradas con drag-and-drop para reordenar.
// Solo activa si la ruta está en DRAFT/OPTIMIZED/APPROVED. Una vez PUBLISHED
// el orden queda congelado (cambiarlo requiere nueva versión + push al chofer).
//
// Tras un reorder, las métricas (distance/duration/ETAs) quedan obsoletas.
// Mostramos un banner sugiriendo "Re-optimizar" para recomputarlas.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
import { Badge, toast, type BadgeTone } from '@verdfrut/ui';
import type { Stop, StopStatus } from '@verdfrut/types';
import { reorderStopsAction, deleteStopFromRouteAction } from '../actions';

interface StopWithStore {
  stop: Stop;
  storeCode: string;
  storeName: string;
  storeAddress: string;
}

interface Props {
  routeId: string;
  /** Si false, render read-only sin drag handles. */
  reorderable: boolean;
  /**
   * ADR-035: si true, estamos post-publicación. Restricciones distintas:
   *   - Solo paradas `pending` se pueden arrastrar (las demás son histórico).
   *   - El payload enviado al server es solo de pending stops.
   *   - El warning indica "se notificará al chofer" en vez de "re-optimiza".
   */
  postPublish?: boolean;
  initialStops: StopWithStore[];
  timezone: string;
}

const STOP_STATUS_LABELS: Record<StopStatus, string> = {
  pending: 'Pendiente',
  arrived: 'En sitio',
  completed: 'Completada',
  skipped: 'Omitida',
};
const STOP_STATUS_TONES: Record<StopStatus, BadgeTone> = {
  pending: 'neutral',
  arrived: 'warning',
  completed: 'success',
  skipped: 'danger',
};

export function SortableStops({
  routeId,
  reorderable,
  postPublish = false,
  initialStops,
  timezone,
}: Props) {
  const router = useRouter();
  const [items, setItems] = useState(initialStops);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((s) => s.stop.id === active.id);
    const newIndex = items.findIndex((s) => s.stop.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    // Post-publish: bloquear si el target o el origen NO es pending.
    // Las paradas no-pending son historia inmutable (completed/arrived/skipped).
    if (postPublish) {
      const draggedStatus = items[oldIndex]?.stop.status;
      const targetStatus = items[newIndex]?.stop.status;
      if (draggedStatus !== 'pending' || targetStatus !== 'pending') {
        toast.error(
          'Solo paradas pendientes se pueden mover',
          'Las paradas completadas/omitidas/en sitio quedan en su orden original.',
        );
        return;
      }
    }

    const reordered = arrayMove(items, oldIndex, newIndex);
    // Renumeramos sequence en local para feedback visual inmediato.
    setItems(
      reordered.map((s, i) => ({ ...s, stop: { ...s.stop, sequence: i + 1 } })),
    );
    setDirty(true);
  }

  function persist() {
    startTransition(async () => {
      // Post-publish: enviamos solo IDs de paradas pending (server espera solo eso).
      // Pre-publish: enviamos todos en el orden actual.
      const idsToSend = postPublish
        ? items.filter((s) => s.stop.status === 'pending').map((s) => s.stop.id)
        : items.map((s) => s.stop.id);
      const res = await reorderStopsAction(routeId, idsToSend);
      if (res.ok) {
        toast.success(
          'Orden guardado',
          postPublish
            ? 'El chofer recibirá una notificación con el nuevo orden.'
            : 'Re-optimiza para actualizar ETAs.',
        );
        setDirty(false);
        router.refresh();
      } else {
        toast.error('Error al guardar', res.error);
        // Revertir UI al orden de DB.
        setItems(initialStops);
        setDirty(false);
      }
    });
  }

  function reset() {
    setItems(initialStops);
    setDirty(false);
  }

  return (
    <div>
      {dirty && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--vf-warn-bg,#fef3c7)] px-4 py-2 text-xs">
          <span className="text-[var(--color-text)]">
            {postPublish
              ? 'Cambiaste el orden de paradas pendientes. Al guardar se notificará al chofer y se subirá la versión.'
              : 'Cambiaste el orden. Las métricas (ETA, distancia) ya no son fiables — re-optimiza después de guardar.'}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={reset}
              disabled={pending}
              className="text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={persist}
              disabled={pending}
              className="font-medium text-[var(--vf-green-600,#15803d)] underline-offset-2 hover:underline disabled:opacity-50"
            >
              {pending ? 'Guardando…' : 'Guardar orden'}
            </button>
          </div>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={reorderable ? handleDragEnd : undefined}
      >
        <SortableContext
          items={items.map((s) => s.stop.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="divide-y" style={{ borderColor: 'var(--vf-line-soft)' }}>
            {items.map((item) => {
              // Post-publish: solo pending stops son draggables (las demás son historia).
              const rowReorderable =
                reorderable && !pending && (!postPublish || item.stop.status === 'pending');
              // ADR-036: borrar parada solo en pre-publish + paradas pending
              // (las arrived/completed/skipped son historia inmutable).
              const rowDeletable =
                reorderable && !pending && !postPublish && item.stop.status === 'pending';
              return (
                <SortableRow
                  key={item.stop.id}
                  item={item}
                  reorderable={rowReorderable}
                  deletable={rowDeletable}
                  routeId={routeId}
                  timezone={timezone}
                />
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function SortableRow({
  item,
  reorderable,
  deletable,
  routeId,
  timezone,
}: {
  item: StopWithStore;
  reorderable: boolean;
  deletable: boolean;
  routeId: string;
  timezone: string;
}) {
  const router = useRouter();
  const [deleting, startDeleteTransition] = useTransition();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.stop.id, disabled: !reorderable });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging || deleting ? 0.5 : 1,
    cursor: reorderable ? 'grab' : 'default',
  };

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`¿Borrar parada #${item.stop.sequence} (${item.storeCode} · ${item.storeName})?`)) {
      return;
    }
    startDeleteTransition(async () => {
      const res = await deleteStopFromRouteAction(item.stop.id);
      if (res.ok) {
        toast.success('Parada borrada', 'Las demás se renumeraron.');
        router.refresh();
      } else {
        toast.error('No se pudo borrar', res.error ?? 'Error desconocido');
      }
    });
  }

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...(reorderable ? attributes : {})}
      {...(reorderable ? listeners : {})}
      className="flex items-start gap-3 px-4 py-3 hover:bg-[var(--vf-surface-2)]"
    >
      {reorderable && (
        <span
          aria-label="Arrastra para reordenar"
          className="mt-1 select-none text-[var(--color-text-subtle)]"
          style={{ fontFamily: 'system-ui' }}
        >
          ⋮⋮
        </span>
      )}
      <div
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-[11px] font-semibold tabular-nums"
        style={{
          background:
            item.stop.status === 'completed'
              ? 'var(--vf-ok)'
              : item.stop.status === 'skipped'
                ? 'var(--vf-crit)'
                : item.stop.status === 'arrived'
                  ? 'var(--vf-warn)'
                  : 'var(--vf-bg-sub)',
          color: item.stop.status === 'pending' ? 'var(--vf-text-mute)' : 'white',
          border: `1px solid ${item.stop.status === 'pending' ? 'var(--vf-line-strong)' : 'transparent'}`,
        }}
      >
        {item.stop.sequence}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[12px]" style={{ color: 'var(--vf-text)' }}>
            {item.storeCode}
          </span>
          <span className="text-sm font-medium" style={{ color: 'var(--vf-text)' }}>
            {item.storeName}
          </span>
        </div>
        <p className="text-[11.5px]" style={{ color: 'var(--vf-text-mute)' }}>
          {item.storeAddress}
        </p>
      </div>
      <div className="text-right">
        <Badge tone={STOP_STATUS_TONES[item.stop.status]}>
          {STOP_STATUS_LABELS[item.stop.status]}
        </Badge>
        {item.stop.plannedArrivalAt && (
          <p
            className="mt-1 font-mono text-[11px] tabular-nums"
            style={{ color: 'var(--vf-text-mute)' }}
          >
            ETA {formatTime(item.stop.plannedArrivalAt)}
          </p>
        )}
        {!item.stop.plannedArrivalAt && item.stop.status === 'pending' && (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--vf-text-faint)' }}>
            sin ETA
          </p>
        )}
      </div>
      {deletable && (
        <button
          type="button"
          aria-label="Borrar parada"
          onClick={handleDelete}
          disabled={deleting}
          onPointerDown={(e) => e.stopPropagation()} // evitar que dnd-kit capture el click
          className="ml-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--vf-text-faint)] hover:bg-[var(--vf-bg-sub)] hover:text-[var(--vf-crit)] disabled:opacity-30"
          title="Borrar parada"
        >
          {deleting ? '…' : '×'}
        </button>
      )}
    </li>
  );
}
