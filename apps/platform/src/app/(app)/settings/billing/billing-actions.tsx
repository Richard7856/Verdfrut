'use client';

// Acciones cliente del /settings/billing: botón checkout/portal + toasts
// de retorno desde Stripe. Server-side define el estado; este componente
// solo dispara el redirect a la URL devuelta por el endpoint.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@tripdrive/ui';

interface Props {
  successFlag: boolean;
  canceledFlag: boolean;
  canCheckout: boolean;
  canPortal: boolean;
}

export function BillingActions({ successFlag, canceledFlag, canCheckout, canPortal }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  // Mostrar toast de retorno una sola vez al cargar la página post-checkout.
  // Luego limpia el query param para que un refresh no re-dispare el toast.
  useEffect(() => {
    if (successFlag) {
      toast.success(
        'Suscripción activada',
        'Recibirás un email con el detalle. La sincronización de seats está activa.',
      );
      router.replace('/settings/billing');
    } else if (canceledFlag) {
      toast.info('Checkout cancelado', 'Puedes intentarlo de nuevo cuando quieras.');
      router.replace('/settings/billing');
    }
  }, [successFlag, canceledFlag, router]);

  async function go() {
    setPending(true);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      const data = await res.json();
      if (!res.ok || !data?.url) {
        toast.error('Error', data?.error ?? 'No se pudo iniciar el checkout.');
        return;
      }
      // Redirect full-page para que Stripe maneje el flujo.
      window.location.href = data.url as string;
    } catch (err) {
      toast.error('Error de red', err instanceof Error ? err.message : 'desconocido');
    } finally {
      setPending(false);
    }
  }

  if (!canCheckout && !canPortal) return null;

  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {canCheckout && (
        <Button type="button" variant="primary" onClick={go} isLoading={pending}>
          {canPortal ? 'Reactivar suscripción' : '💳 Empezar Pro'}
        </Button>
      )}
      {canPortal && (
        <Button type="button" variant="secondary" onClick={go} isLoading={pending}>
          Administrar suscripción
        </Button>
      )}
    </div>
  );
}
