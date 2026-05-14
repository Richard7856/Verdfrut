'use client';

import { useRouter } from 'next/navigation';
import type { Depot, Zone, Vehicle } from '@tripdrive/types';
import { VehicleForm } from '../vehicle-form';
import { updateVehicleAction } from '../actions';

interface Props {
  vehicle: Vehicle;
  zones: Zone[];
  depots: Depot[];
}

export function VehicleEditClient({ vehicle, zones, depots }: Props) {
  const router = useRouter();
  const boundAction = updateVehicleAction.bind(null, vehicle.id);

  return (
    <VehicleForm
      mode="edit"
      zones={zones}
      depots={depots}
      initial={vehicle}
      action={boundAction}
      submitLabel="Guardar cambios"
      onSuccess={() => {
        // Tras guardar, regresar a la lista para que el operador vea el
        // cambio reflejado en la tabla.
        router.push('/settings/vehicles');
        router.refresh();
      }}
    />
  );
}
