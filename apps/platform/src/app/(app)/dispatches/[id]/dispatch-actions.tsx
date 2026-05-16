'use client';

// Acciones del tiro: editar nombre/notas, eliminar/cancelar (#75 cascade).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';
import type { Dispatch } from '@tripdrive/types';
import { updateDispatchAction, deleteDispatchAction } from '../actions';

interface Props {
  dispatch: Dispatch;
}

export function DispatchActions({ dispatch }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(dispatch.name);
  const [notes, setNotes] = useState(dispatch.notes ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateDispatchAction(dispatch.id, { name, notes });
      if (!res.ok) {
        setError(res.error ?? 'Error');
        return;
      }
      setEditing(false);
      router.refresh();
    });
  }

  // #75 — Eliminar tiro completo en cascada. Dos pasos:
  //  1. Primer click: el server detecta rutas PUBLISHED/IN_PROGRESS y nos pide
  //     confirmación específica (devuelve activeRoutesCount).
  //  2. Segundo confirm con el count: relanzamos con confirmActive=true.
  //
  // El server decide si el dispatch sobrevive (rutas históricas) o se elimina.
  function handleDelete() {
    if (
      !confirm(
        `¿Eliminar el tiro "${dispatch.name}"?\n\n` +
          `• Las rutas pre-publicación (borrador/optimizada/aprobada) se borran completas.\n` +
          `• Las rutas publicadas/en curso se cancelan (chofer las verá como canceladas).\n` +
          `• Si hay rutas históricas (completadas/canceladas) el tiro queda como contenedor.`,
      )
    )
      return;
    runDelete(false);
  }

  function runDelete(confirmActive: boolean) {
    startTransition(async () => {
      const res = await deleteDispatchAction(dispatch.id, { confirmActive });
      if (!res.ok) {
        // Si hay rutas activas y aún no confirmamos, pedimos confirm extra.
        if (res.activeRoutesCount && res.activeRoutesCount > 0 && !confirmActive) {
          const proceed = confirm(
            `⚠️ Hay ${res.activeRoutesCount} ruta(s) PUBLICADA(S) o EN CURSO.\n\n` +
              `Si continúas, esas rutas se cancelarán y el chofer dejará de verlas.\n` +
              `Esta acción NO se puede deshacer.\n\n` +
              `¿Continuar?`,
          );
          if (!proceed) return;
          runDelete(true);
          return;
        }
        setError(res.error ?? 'Error');
        toast.error('No se pudo eliminar', res.error);
        return;
      }
      if (res.dispatchKept) {
        toast.success(
          'Tiro cancelado',
          'Las rutas fueron canceladas. El tiro queda visible como contenedor del histórico.',
        );
        router.refresh();
      } else {
        toast.success('Tiro eliminado');
        router.push('/dispatches');
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-1">
        <a
          href={`/print/dispatches/${dispatch.id}`}
          target="_blank"
          rel="noopener"
          title="Vista imprimible: 1 hoja por camioneta para que el almacenista arme el layout."
        >
          <Button type="button" variant="ghost" size="sm">
            📄 PDF
          </Button>
        </a>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Editar
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={pending}>
          Eliminar
        </Button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-[var(--radius-lg)] bg-[var(--vf-surface-1)] p-5 shadow-xl">
        <h3 className="text-base font-semibold text-[var(--color-text)]">Editar tiro</h3>
        <div className="mt-3 flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">Nombre</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--vf-green-500)] focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-[var(--color-text)]">Notas</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={3}
              className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--vf-green-500)] focus:outline-none"
            />
          </div>
          {error && <p className="text-xs text-[var(--color-danger-fg)]">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={handleSave}
            isLoading={pending}
            disabled={pending || name.trim().length < 2}
          >
            Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
