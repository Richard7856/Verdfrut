'use client';

// ADR-036: agregar paradas manualmente a una ruta existente.
// Útil cuando el optimizer no asignó algunas tiendas (lejos del depot, fuera
// del shift, sin capacity) y el dispatcher decide forzarlas a la ruta.
//
// Solo aparece para rutas en DRAFT/OPTIMIZED/APPROVED. Una vez PUBLISHED, agregar
// stops requeriría reoptimizar + notificar al chofer (issue #66).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@verdfrut/ui';
import { addStopToRouteAction } from '../actions';

interface AvailableStore {
  id: string;
  code: string;
  name: string;
}

interface Props {
  routeId: string;
  /** Tiendas de la zona que NO están en esta ruta. */
  availableStores: AvailableStore[];
}

export function AddStopButton({ routeId, availableStores }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [storeId, setStoreId] = useState<string>('');
  const [pending, startTransition] = useTransition();

  if (availableStores.length === 0) {
    return null; // Nada que agregar.
  }

  function submit() {
    if (!storeId) {
      toast.error('Selecciona una tienda', '');
      return;
    }
    startTransition(async () => {
      const res = await addStopToRouteAction(routeId, storeId);
      if (res.ok) {
        toast.success('Parada agregada', `Re-optimiza para recalcular ETAs.`);
        setOpen(false);
        setStoreId('');
        router.refresh();
      } else {
        toast.error('No se pudo agregar', res.error ?? 'Error desconocido');
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text)] hover:bg-[var(--vf-surface-2)]"
      >
        + Agregar parada manualmente
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] p-3">
      <label className="text-xs font-medium" style={{ color: 'var(--vf-text)' }}>
        Tienda a agregar
      </label>
      <select
        value={storeId}
        onChange={(e) => setStoreId(e.target.value)}
        disabled={pending}
        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--vf-surface)] px-2 py-1.5 text-sm"
        style={{ color: 'var(--vf-text)' }}
      >
        <option value="">— Selecciona una tienda —</option>
        {availableStores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.code} · {s.name}
          </option>
        ))}
      </select>
      <p className="text-[11px]" style={{ color: 'var(--vf-text-mute)' }}>
        Se agrega al final de la ruta sin ETA. Re-optimiza después si quieres recalcular.
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setStoreId('');
          }}
          disabled={pending}
          className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline disabled:opacity-50"
        >
          Cancelar
        </button>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={submit}
          disabled={pending || !storeId}
        >
          {pending ? 'Agregando…' : 'Agregar'}
        </Button>
      </div>
    </div>
  );
}
