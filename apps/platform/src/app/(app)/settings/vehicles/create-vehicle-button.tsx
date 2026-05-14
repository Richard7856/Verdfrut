'use client';

import { useState } from 'react';
import { Button, Modal } from '@tripdrive/ui';
import type { Depot, Zone } from '@tripdrive/types';
import { createVehicleAction } from './actions';
import { VehicleForm } from './vehicle-form';

export function CreateVehicleButton({ zones, depots }: { zones: Zone[]; depots: Depot[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Nuevo camión
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nuevo camión"
        description="Capacidad multidimensional + specs opcionales. Usa la IA para llenar datos típicos del modelo."
        size="xl"
      >
        <VehicleForm
          mode="create"
          zones={zones}
          depots={depots}
          action={createVehicleAction}
          submitLabel="Registrar camión"
          onSuccess={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
