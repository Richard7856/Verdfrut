'use client';

// ADR-048: quitar una camioneta del tiro y redistribuir sus paradas entre las
// camionetas restantes. Si era la última, deja el tiro vacío.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, toast } from '@tripdrive/ui';
import { removeVehicleFromDispatchAction } from '../actions';
import { persistRestructureSnapshot } from './restructure-snapshot-banner';

interface Props {
  routeId: string;
  /** Necesario para guardar el snapshot del tiro en sessionStorage tras éxito (H3.4). */
  dispatchId: string;
  vehicleLabel: string;
  /** Cuántas camionetas quedarán después. UI cambia copy si va a quedar 0 (cancelación pura) o ≥1 (redistribución). */
  remainingAfter: number;
  /** Cuántas paradas tiene esta ruta — afecta cuánto ruido genera el split. */
  stopsCount: number;
  /** H3.5: ¿alguna ruta del tiro tiene reorders manuales? Avisar al user. */
  hasManualReorders?: boolean;
}

export function RemoveVehicleButton({
  routeId,
  dispatchId,
  vehicleLabel,
  remainingAfter,
  stopsCount,
  hasManualReorders = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await removeVehicleFromDispatchAction(routeId);
      if (res.ok) {
        if (res.before && res.after) {
          persistRestructureSnapshot(dispatchId, {
            before: res.before,
            after: res.after,
            unassignedStoreIds: res.unassignedStoreIds ?? [],
          });
        }
        toast.success(
          remainingAfter === 0
            ? 'Camioneta quitada — tiro queda vacío'
            : `Camioneta quitada — ${stopsCount} paradas re-distribuidas`,
        );
        setOpen(false);
        router.refresh();
      } else {
        toast.error('Error al quitar camioneta', res.error);
      }
    });
  }

  const willRedistribute = remainingAfter >= 1 && stopsCount > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-[var(--color-text-muted)] underline-offset-2 hover:text-[var(--color-danger-fg)] hover:underline"
        title="Quitar esta camioneta del tiro"
      >
        Quitar
      </button>
      <Modal
        open={open}
        onClose={() => !pending && setOpen(false)}
        title={`Quitar ${vehicleLabel} del tiro`}
        description={
          willRedistribute
            ? `Se cancelará esta ruta y sus ${stopsCount} paradas se redistribuirán entre las ${remainingAfter} camionetas restantes.`
            : remainingAfter === 0
              ? 'Esta es la única camioneta del tiro. Al quitarla, el tiro queda vacío (sin paradas).'
              : 'Esta ruta no tiene paradas. Solo se cancelará la ruta.'
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={submit} isLoading={pending}>
              {willRedistribute ? 'Quitar y re-rutear' : 'Quitar camioneta'}
            </Button>
          </>
        }
      >
        {willRedistribute && hasManualReorders && (
          <div
            className="mb-2 rounded border px-2 py-1.5 text-[11px]"
            style={{
              borderColor: 'var(--color-warning-border, #fbbf24)',
              background: 'var(--color-warning-bg, #fef3c7)',
              color: 'var(--color-warning-fg, #92400e)',
            }}
          >
            ⚠ Las rutas del tiro tienen cambios manuales (reorden, paradas
            agregadas/borradas). Al redistribuir, esos ajustes se recalculan
            desde cero y el orden manual se pierde.
          </div>
        )}
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Solo se permite quitar camionetas en pre-publicación
          (DRAFT/OPTIMIZED/APPROVED). Si esta ruta ya está PUBLISHED+ la acción
          fallará — usa cancelar manual.
        </p>
      </Modal>
    </>
  );
}
