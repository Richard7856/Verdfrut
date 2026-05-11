'use client';

// ADR-047: selector inline para sobrescribir el depot de salida de UNA ruta.
// Replica el patrón de DriverAssignment. Si el override es null la ruta
// hereda el depot del vehículo (comportamiento histórico).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Select, toast } from '@tripdrive/ui';
import type { Depot, Route } from '@tripdrive/types';
import { assignDepotToRouteAction } from '../actions';

interface Props {
  route: Route;
  /** Depot que la ruta usa hoy: override si está seteado, si no el del vehículo. */
  effectiveDepot: { id: string; code: string; name: string } | null;
  /** Indica si el depot mostrado viene del override (true) o se hereda del vehículo (false). */
  isOverride: boolean;
  /** Lista de depots activos donde el dispatcher puede pedir que arranque la ruta. */
  availableDepots: Pick<Depot, 'id' | 'code' | 'name'>[];
}

export function DepotAssignment({ route, effectiveDepot, isOverride, availableDepots }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  // '' = "usar el del vehículo" (override null). Si hay override, ese id.
  const [selectedId, setSelectedId] = useState(isOverride ? (effectiveDepot?.id ?? '') : '');

  const editable = ['DRAFT', 'OPTIMIZED', 'APPROVED'].includes(route.status);

  function save() {
    startTransition(async () => {
      const newDepotId = selectedId === '' ? null : selectedId;
      const res = await assignDepotToRouteAction(route.id, newDepotId);
      if (res.ok) {
        toast.success(newDepotId ? 'CEDIS de salida actualizado' : 'CEDIS volvió al del camión');
        setEditing(false);
        router.refresh();
      } else {
        toast.error('Error al cambiar CEDIS', res.error);
      }
    });
  }

  function cancel() {
    setSelectedId(isOverride ? (effectiveDepot?.id ?? '') : '');
    setEditing(false);
  }

  // Etiqueta del depot actual: incluye un sufijo "(override)" cuando viene de la ruta,
  // así el dispatcher ve claro si la ruta tiene un origen distinto al del camión.
  const display = effectiveDepot
    ? `${effectiveDepot.code}${isOverride ? ' · override' : ''}`
    : null;

  if (!editable) {
    return (
      <div className="flex items-center justify-between text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          CEDIS salida
        </dt>
        <dd
          className="font-mono text-[12.5px] tabular-nums"
          style={{ color: 'var(--color-text)' }}
        >
          {display ?? <em>sin depot</em>}
        </dd>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="flex items-center justify-between gap-2 text-sm">
        <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          CEDIS salida
        </dt>
        <dd className="flex items-center gap-2 text-right">
          <span
            className="font-mono text-[12.5px] tabular-nums"
            style={{
              color: effectiveDepot ? 'var(--color-text)' : 'var(--color-text-muted)',
            }}
          >
            {display ?? <em>sin depot</em>}
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
          >
            Cambiar
          </button>
        </dd>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      <dt className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
        CEDIS salida
      </dt>
      <Select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        disabled={pending}
      >
        <option value="">— Usar el del camión —</option>
        {availableDepots.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} · {d.name}
          </option>
        ))}
      </Select>
      <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
        Cambiar el CEDIS recalcula km y ETAs de la ruta automáticamente.
      </p>
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
