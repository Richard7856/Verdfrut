'use client';

// Agregar una camioneta al tiro como ruta VACÍA — sin tocar las paradas
// existentes. El dispatcher mueve tiendas a la nueva ruta a mano desde el mapa
// (selección bulk + "Mover a → camioneta") o usa "⚡ Optimizar tiro → Mover
// entre camionetas" si quiere que VROOM rebalance todo.
//
// Antes (ADR-048): este botón disparaba auto-redistribute con VROOM. Se quitó
// porque a) sobrescribía el trabajo manual del dispatcher, b) en tiros multi-
// zona dejaba paradas sin asignar.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Select, toast } from '@tripdrive/ui';
import { addEmptyRouteToDispatchAction } from '../actions';

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
   * @deprecated Ya no se usa — agregar camioneta no recalcula nada.
   * Se mantiene en la API para no romper a quien la pase desde el server.
   */
  hasManualReorders?: boolean;
}

export function AddVehicleButton({
  dispatchId,
  availableVehicles,
  availableDrivers,
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
      const res = await addEmptyRouteToDispatchAction(
        dispatchId,
        vehicleId,
        driverId === '' ? null : driverId,
      );
      if (res.ok) {
        toast.success(
          'Camioneta agregada',
          'Ruta vacía creada. Mueve paradas a ella desde el mapa o usa "⚡ Optimizar tiro".',
        );
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
            : 'Agrega una camioneta vacía — tú decides qué paradas le tocan'
        }
      >
        + Agregar camioneta
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Agregar camioneta al tiro"
        description="Se crea como ruta vacía. Mueve paradas con la selección bulk del mapa, o re-balancea con ⚡ Optimizar tiro."
        footer={
          <>
            <Button variant="ghost" onClick={close} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={submit} isLoading={pending}>
              Agregar camioneta
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
          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            La camioneta se agrega vacía. Ninguna parada existente se mueve ni
            se recalcula automáticamente.
          </p>
        </div>
      </Modal>
    </>
  );
}
