'use client';

import { useTransition } from 'react';
import { Button, toast } from '@verdfrut/ui';
import type { UserProfile } from '@verdfrut/types';
import { toggleUserActiveAction } from './actions';

export function ToggleUserActiveCell({ user }: { user: UserProfile }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await toggleUserActiveAction(user.id, !user.isActive);
          if (res.ok) {
            toast.success(user.isActive ? 'Usuario desactivado' : 'Usuario activado');
          } else {
            toast.error('Error', res.error);
          }
        })
      }
    >
      {user.isActive ? 'Desactivar' : 'Activar'}
    </Button>
  );
}
