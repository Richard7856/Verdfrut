'use client';

// ADR-048: quitar una camioneta del tiro y redistribuir sus paradas entre las
// camionetas restantes. Si era la última, deja el tiro vacío.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, toast } from '@verdfrut/ui';
import { removeVehicleFromDispatchAction } from '../actions';

interface Props {
  routeId: string;
  vehicleLabel: string;
  /** Cuántas camionetas quedarán después. UI cambia copy si va a quedar 0 (cancelación pura) o ≥1 (redistribución). */
  remainingAfter: number;
  /** Cuántas paradas tiene esta ruta — afecta cuánto ruido genera el split. */
  stopsCount: number;
}

export function RemoveVehicleButton({ routeId, vehicleLabel, remainingAfter, stopsCount }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      const res = await removeVehicleFromDispatchAction(routeId);
      if (res.ok) {
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
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Solo se permite quitar camionetas en pre-publicación
          (DRAFT/OPTIMIZED/APPROVED). Si esta ruta ya está PUBLISHED+ la acción
          fallará — usa cancelar manual.
        </p>
      </Modal>
    </>
  );
}
