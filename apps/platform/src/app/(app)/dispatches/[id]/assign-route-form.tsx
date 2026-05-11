'use client';

// Form simple para vincular una ruta existente (huérfana) a este tiro.
// Solo muestra rutas candidatas: misma zona, misma fecha, sin dispatch_id.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@tripdrive/ui';
import type { Route, Vehicle } from '@tripdrive/types';
import { assignRouteToDispatchAction } from '../actions';

interface Props {
  dispatchId: string;
  candidates: Route[];
  vehicles: Vehicle[];
}

export function AssignRouteForm({ dispatchId, candidates, vehicles }: Props) {
  const router = useRouter();
  const [routeId, setRouteId] = useState(candidates[0]?.id ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit() {
    if (!routeId) return;
    setError(null);
    startTransition(async () => {
      const res = await assignRouteToDispatchAction(dispatchId, routeId);
      if (!res.ok) {
        setError(res.error ?? 'Error al vincular');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <select
        value={routeId}
        onChange={(e) => setRouteId(e.target.value)}
        className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-2)] px-3 py-2 text-sm text-[var(--color-text)] focus:border-[var(--vf-green-500)] focus:outline-none"
      >
        {candidates.map((r) => {
          const v = vehicles.find((v) => v.id === r.vehicleId);
          return (
            <option key={r.id} value={r.id}>
              {r.name} ({v?.alias ?? v?.plate ?? '—'})
            </option>
          );
        })}
      </select>
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={handleSubmit} disabled={pending || !routeId}>
          Vincular ruta
        </Button>
        {error && <span className="text-xs text-[var(--color-danger-fg)]">{error}</span>}
      </div>
    </div>
  );
}
