'use client';

// Step `tienda_abierta_check` (compartido por flujo cerrada y báscula).
// Después del chat con el comercial, el chofer reporta el resultado:
//   - Sí, ya entró / báscula funciona ahora → convertir report a `entrega` y
//     reusar la foto previa (facade/scale) como `arrival_exhibit`.
//   - No, sigue sin atender → cerrar como `sin_entrega`. La parada queda skipped.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@verdfrut/ui';
import { convertToEntregaAction, submitNonEntregaAction } from '@/app/route/stop/[id]/actions';
import type { StepProps } from '../stop-detail-client';

export function TiendaAbiertaCheckStep(props: StepProps) {
  const { report, setError } = props;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [localPending, setLocalPending] = useState<'yes' | 'no' | null>(null);

  const isClosedShop = report.type === 'tienda_cerrada';
  const yesLabel = isClosedShop ? 'Sí, abrieron' : 'Sí, ya funciona';
  const noLabel = isClosedShop ? 'No, sigue cerrada' : 'No, sigue sin funcionar';

  function handleYes() {
    setError(null);
    setLocalPending('yes');
    startTransition(async () => {
      const res = await convertToEntregaAction(report.id);
      if (!res.ok) {
        setError(res.error);
        setLocalPending(null);
        return;
      }
      router.refresh();
    });
  }

  function handleNo() {
    setError(null);
    setLocalPending('no');
    startTransition(async () => {
      const res = await submitNonEntregaAction(report.id, 'sin_entrega');
      if (!res.ok) {
        setError(res.error);
        setLocalPending(null);
        return;
      }
      router.replace('/route');
    });
  }

  return (
    <section className="flex flex-col gap-4 px-4 py-5">
      <div>
        <h2 className="text-lg font-semibold text-[var(--color-text)]">
          {isClosedShop ? '¿Se pudo abrir la tienda?' : '¿Ya funciona la báscula?'}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {isClosedShop
            ? 'Si abrieron, continuamos con la entrega normal. Si no, cerramos sin entrega.'
            : 'Si la báscula ya opera, continuamos con la entrega. Si no, cerramos sin entrega.'}
        </p>
      </div>

      {props.error && (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-danger-border)] bg-[var(--color-danger-bg)] px-3 py-2 text-sm text-[var(--color-danger-fg)]">
          {props.error}
        </div>
      )}

      <div className="flex flex-col gap-2 pt-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={handleYes}
          isLoading={localPending === 'yes' && pending}
          disabled={pending}
          className="w-full"
        >
          {yesLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={handleNo}
          isLoading={localPending === 'no' && pending}
          disabled={pending}
          className="w-full"
        >
          {noLabel}
        </Button>
      </div>
    </section>
  );
}
