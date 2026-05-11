'use client';

import { useTransition } from 'react';
import { Button, toast } from '@tripdrive/ui';
import type { Store } from '@tripdrive/types';
import { toggleStoreActiveAction } from './actions';

export function ToggleStoreActiveCell({ store }: { store: Store }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleStoreActiveAction(store.id, !store.isActive);
          if (res.ok) {
            toast.success(store.isActive ? 'Tienda desactivada' : 'Tienda activada');
          } else {
            toast.error('Error', res.error);
          }
        })
      }
    >
      {store.isActive ? 'Desactivar' : 'Activar'}
    </Button>
  );
}
