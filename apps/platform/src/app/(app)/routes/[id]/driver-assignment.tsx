'use client';

// Selector inline para asignar/reasignar chofer a una ruta.
// Solo editable si la ruta está en DRAFT/OPTIMIZED/APPROVED. Una vez PUBLISHED
// el chofer ya recibió la notificación — cambiarlo requiere re-publicar (sprint futuro).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, toast } from '@verdfrut/ui';
import type { Driver, Route, UserProfile } from '@verdfrut/types';
import { assignDriverAction } from '../actions';

interface DriverWithProfile {
  driver: Driver;
  profile: UserProfile;
}

interface Props {
  route: Route;
  /** Chofer actual (si lo hay) — Driver row + UserProfile para mostrar nombre. */
  currentDriver: DriverWithProfile | null;
  /** Lista de choferes disponibles en la zona de la ruta, activos. */
  availableDrivers: DriverWithProfile[];
}

export function DriverAssignment({ route, currentDriver, availableDrivers }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [selectedId, setSelectedId] = useState(currentDriver?.driver.id ?? '');

  const editable = ['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status);

  function save() {
    startTransition(async () => {
      const newDriverId = selectedId === '' ? null : selectedId;
      const res = await assignDriverAction(route.id, newDriverId);
      if (res.ok) {
        toast.success(newDriverId ? 'Chofer asignado' : 'Chofer removido');
        setEditing(false);
        router.refresh();
      } else {
        toast.error('Error al asignar', res.error);
      }
    });
  }

  function cancel() {
    setSelectedId(currentDriver?.driver.id ?? '');
    setEditing(false);
  }

  // Read-only: ruta publicada o sin permisos de edición.
  if (!editable) {
    return (
      <div className="flex items-center justify-between text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Chofer
        </dt>
        <dd
          className="font-mono text-[12.5px] tabular-nums"
          style={{ color: 'var(--color-text)' }}
        >
          {currentDriver?.profile.fullName ?? <em>sin asignar</em>}
        </dd>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Chofer
        </dt>
        <dd className="flex items-center gap-2 text-right">
          <span
            className="font-mono text-[12.5px] tabular-nums"
            style={{
              color: currentDriver
                ? 'var(--color-text)'
                : 'var(--color-text-muted)',
            }}
          >
            {currentDriver?.profile.fullName ?? <em>sin asignar</em>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
          >
            {currentDriver ? 'Cambiar' : 'Asignar'}
          </button>
        </dd>
      </div>
    );
  }

  // Modo edición.
  return (
    <div className="flex flex-col gap-2 text-sm">
      <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        Chofer
      </dt>
      <Select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={pending}
      >
        <option value="">— Sin asignar —</option>
        {availableDrivers.map((d) => (
          <option key={d.driver.id} value={d.driver.id}>
            {d.profile.fullName}
            {d.profile.phone ? ` · ${d.profile.phone}` : ''}
          </option>
        ))}
      </Select>
      {availableDrivers.length === 0 && (
        <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
          Sin choferes activos en esta zona. Crea uno en /settings/users.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="primary" size="sm" onClick={save} isLoading={pending}>
          Guardar
        </Button>
      </div>
    </div>
  );
}
