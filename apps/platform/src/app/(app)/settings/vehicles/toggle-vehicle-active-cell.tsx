'use client';

import { useTransition } from 'react';
import { Button, toast } from '@verdfrut/ui';
import type { Vehicle } from '@verdfrut/types';
import { toggleVehicleActiveAction } from './actions';

export function ToggleVehicleActiveCell({ vehicle }: { vehicle: Vehicle }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleVehicleActiveAction(vehicle.id, !vehicle.isActive);
          if (res.ok) {
            toast.success(vehicle.isActive ? 'Camión desactivado' : 'Camión activado');
          } else {
            toast.error('Error', res.error);
          }
        })
      }
    >
      {vehicle.isActive ? 'Desactivar' : 'Activar'}
    </Button>
  );
}
