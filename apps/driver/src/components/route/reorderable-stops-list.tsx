'use client';

// ADR-035: lista de paradas con modo "editar orden" para el chofer.
// Diseño: en lugar de drag & drop (frágil en touch + scroll de móvil),
// usamos un modo edición con flechas ↑↓ en cada parada pendiente. Más explícito,
// menos errores de gesto. Solo paradas pending son movibles; las completadas/
// en sitio/omitidas se quedan fijas arriba.
//
// Flujo:
//  1. Lista normal (sin modo edición) → click en "Editar orden" para entrar.
//  2. En modo edición, cada pending stop tiene flechas; tap mueve 1 posición.
//  3. Al terminar, "Guardar" persiste vía reorderStopsByDriverAction; "Cancelar"
//     descarta cambios locales sin tocar BD.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import type { StopWithStore } from '@/lib/queries/route';
import { StopCard } from './stop-card';
import { reorderStopsByDriverAction } from '@/app/route/actions';

interface Props {
  initialStops: StopWithStore[];
  nextStopId: string | null;
  timezone: string;
}

export function ReorderableStopsList({ initialStops, nextStopId, timezone }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState(initialStops);
  const [pending, startTransition] = useTransition();

  const pendingCount = items.filter((s) => s.stop.status === 'pending').length;
  const showEditButton = !editing && pendingCount >= 2;

  function moveUp(index: number) {
    // Solo se puede mover hacia arriba si la posición previa también es pending.
    if (index <= 0) return;
    const prev = items[index - 1];
    const curr = items[index];
    if (!prev || !curr) return;
    if (curr.stop.status !== 'pending' || prev.stop.status !== 'pending') return;
    const next = [...items];
    next[index - 1] = curr;
    next[index] = prev;
    setItems(next);
  }

  function moveDown(index: number) {
    if (index >= items.length - 1) return;
    const next_ = items[index + 1];
    const curr = items[index];
    if (!next_ || !curr) return;
    if (curr.stop.status !== 'pending' || next_.stop.status !== 'pending') return;
    const arr = [...items];
    arr[index + 1] = curr;
    arr[index] = next_;
    setItems(arr);
  }

  function cancel() {
    setItems(initialStops);
    setEditing(false);
  }

  function save() {
    const orderedPending = items.filter((s) => s.stop.status === 'pending').map((s) => s.stop.id);
    startTransition(async () => {
      const res = await reorderStopsByDriverAction(orderedPending);
      if (res.ok) {
        toast.success('Orden guardado', 'Tus paradas pendientes están en el nuevo orden.');
        setEditing(false);
        router.refresh();
      } else {
        toast.error('No se pudo guardar', res.error ?? 'Error desconocido.');
        setItems(initialStops);
        setEditing(false);
      }
    });
  }

  return (
    <>
      {showEditButton && (
        <div className="px-4 pt-2">
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="w-full rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-muted)] hover:bg-[var(--vf-surface-2)]"
          >
            ✎ Cambiar orden de paradas pendientes
          </button>
        </div>
      )}

      {editing && (
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-warning-bg,#fef3c7)] px-4 py-2 text-xs">
          <span className="text-[var(--color-warning-fg,#92400e)]">
            Modo edición · usa ↑ ↓ para mover paradas pendientes.
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancel}
              disabled={pending}
              className="text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
            >
              Cancelar
            </button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              disabled={pending}
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      )}

      <ul className="flex flex-col gap-2 p-4">
        {items.map((item, index) => {
          const canMoveUp =
            editing &&
            item.stop.status === 'pending' &&
            index > 0 &&
            items[index - 1]?.stop.status === 'pending';
          const canMoveDown =
            editing &&
            item.stop.status === 'pending' &&
            index < items.length - 1 &&
            items[index + 1]?.stop.status === 'pending';

          return (
            <li key={item.stop.id} className="relative">
              {editing ? (
                // En modo edición, el card NO es clickable (no link). Mostramos
                // versión "fría" del card con flechas.
                <div className="flex items-stretch gap-2">
                  <div className="flex flex-col justify-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(index)}
                      disabled={!canMoveUp}
                      aria-label="Mover arriba"
                      className="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] text-[var(--color-text)] disabled:opacity-30"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(index)}
                      disabled={!canMoveDown}
                      aria-label="Mover abajo"
                      className="grid h-8 w-8 place-items-center rounded-md border border-[var(--color-border)] bg-[var(--vf-surface-2)] text-[var(--color-text)] disabled:opacity-30"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 pointer-events-none opacity-90">
                    <StopCard item={item} isNext={false} timezone={timezone} />
                  </div>
                </div>
              ) : (
                <StopCard
                  item={item}
                  isNext={item.stop.id === nextStopId}
                  timezone={timezone}
                />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
