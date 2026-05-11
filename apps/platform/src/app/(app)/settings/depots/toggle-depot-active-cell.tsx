'use client';

import { useTransition } from 'react';
import { Button, toast } from '@tripdrive/ui';
import type { Depot } from '@tripdrive/types';
import { toggleDepotActiveAction } from './actions';

export function ToggleDepotActiveCell({ depot }: { depot: Depot }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleDepotActiveAction(depot.id, !depot.isActive);
          if (res.ok) toast.success(depot.isActive ? 'CEDIS desactivado' : 'CEDIS activado');
          else toast.error('Error', res.error);
        })
      }
    >
      {depot.isActive ? 'Desactivar' : 'Activar'}
    </Button>
  );
}
