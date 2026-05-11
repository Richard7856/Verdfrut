'use client';

// ADR-048: agregar una camioneta al tiro y re-rutear todo. El dispatcher elige
// vehículo + chofer; el optimizer redistribuye las paradas existentes entre
// la flota nueva. Si alguna ruta del tiro está PUBLISHED+ se aborta server-side.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Select, toast } from '@tripdrive/ui';
import { addVehicleToDispatchAction } from '../actions';
import { persistRestructureSnapshot } from './restructure-snapshot-banner';

interface VehicleOption {
  id: string;
  label: string;
  zoneId: string;
}

interface DriverOption {
  id: string;
  fullName: string;
  zoneId: string;
}

interface Props {
  dispatchId: string;
  /** Vehículos disponibles (no asignados ya a este tiro). Filtrados por zona del tiro. */
  availableVehicles: VehicleOption[];
  /** Choferes activos en la zona del tiro. */
  availableDrivers: DriverOption[];
  /**
   * H3.5: si alguna ruta del tiro tuvo reorder manual o stops agregados/borrados
   * después del optimizer (version > 1), avisar al dispatcher porque
   * redistribuir va a recalcular desde cero, perdiendo el orden manual.
   */
  hasManualReorders?: boolean;
}

export function AddVehicleButton({
  dispatchId,
  availableVehicles,
  availableDrivers,
  hasManualReorders = false,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [vehicleId, setVehicleId] = useState('');
  const [driverId, setDriverId] = useState('');

  function reset() {
    setVehicleId('');
    setDriverId('');
  }

  function close() {
    setOpen(false);
    reset();
  }

  function submit() {
    if (!vehicleId) {
      toast.error('Selecciona un camión');
      return;
    }
    startTransition(async () => {
      const res = await addVehicleToDispatchAction(
        dispatchId,
        vehicleId,
        driverId === '' ? null : driverId,
      );
      if (res.ok) {
        // H3.4: guardar snapshot pre/post para que el banner muestre el delta.
        if (res.before && res.after) {
          persistRestructureSnapshot(dispatchId, {
            before: res.before,
            after: res.after,
            unassignedStoreIds: res.unassignedStoreIds ?? [],
          });
        }
        toast.success('Camioneta agregada — paradas re-distribuidas entre todas las rutas');
        close();
        router.refresh();
      } else {
        toast.error('Error al agregar camioneta', res.error);
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="primary"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={availableVehicles.length === 0}
        title={
          availableVehicles.length === 0
            ? 'No hay más camiones disponibles en esta zona'
            : undefined
        }
      >
        + Agregar camioneta
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Agregar camioneta al tiro"
        description="El optimizador volverá a repartir todas las paradas del tiro entre las camionetas resultantes."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} isLoading={pending}>
              Agregar y re-rutear
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Camión
            </label>
            <Select
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              disabled={pending}
            >
              <option value="">— Selecciona un camión —</option>
              {availableVehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Chofer (opcional)
            </label>
            <Select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              disabled={pending}
            >
              <option value="">— Sin asignar —</option>
              {availableDrivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fullName}
                </option>
              ))}
            </Select>
          </div>
          {hasManualReorders && (
            <div
              className="rounded border px-2 py-1.5 text-[11px]"
              style={{
                borderColor: 'var(--color-warning-border, #fbbf24)',
                background: 'var(--color-warning-bg, #fef3c7)',
                color: 'var(--color-warning-fg, #92400e)',
              }}
            >
              ⚠ Alguna ruta del tiro tiene cambios manuales (reorden, agregar o
              borrar paradas). Redistribuir va a recalcular el orden desde cero —
              esos ajustes se pierden.
            </div>
          )}
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            Solo se re-distribuyen tiros con todas sus rutas en pre-publicación
            (DRAFT/OPTIMIZED/APPROVED). Si alguna ruta ya está publicada o en
            curso, esta acción aborta y debes hacerlo manualmente.
          </p>
        </div>
      </Modal>
    </>
  );
}
