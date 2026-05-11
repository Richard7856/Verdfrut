'use client';

import { useTransition } from 'react';
import { Button } from '@tripdrive/ui';
import { logoutAction } from '@/app/(auth)/login/actions';

export function LogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="ghost"
      size="sm"
      isLoading={pending}
      onClick={() => startTransition(async () => { await logoutAction(); })}
    >
      Salir
    </Button>
  );
}
