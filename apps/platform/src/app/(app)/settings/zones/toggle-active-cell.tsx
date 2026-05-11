'use client';

import { useTransition } from 'react';
import { Button, toast } from '@tripdrive/ui';
import type { Zone } from '@tripdrive/types';
import { toggleZoneActiveAction } from './actions';

export function ToggleActiveCell({ zone }: { zone: Zone }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleZoneActiveAction(zone.id, !zone.isActive);
          if (res.ok) {
            toast.success(zone.isActive ? 'Zona desactivada' : 'Zona activada');
          } else {
            toast.error('Error', res.error);
          }
        })
      }
    >
      {zone.isActive ? 'Desactivar' : 'Activar'}
    </Button>
  );
}
