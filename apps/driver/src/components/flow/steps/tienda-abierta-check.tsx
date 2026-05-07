'use client';

// Step `tienda_abierta_check` (compartido por flujo cerrada y báscula).
// Después del chat con el comercial, el chofer reporta el resultado:
//   - Sí, ya entró / báscula funciona ahora → convertir report a `entrega` y
//     reusar la foto previa (facade/scale) como `arrival_exhibit`.
//   - No, sigue sin atender → cerrar como `sin_entrega`. La parada queda skipped.

import { useState } from 'react';
import { Button } from '@verdfrut/ui';
import type { StepProps } from '../stop-detail-client';

// Las acciones de "sí abrieron" y "no, cerramos" ahora pasan por el outbox
// (ADR-019). Encolamos y la UI optimista se actualiza desde stop-detail-client.

export function TiendaAbiertaCheckStep(props: StepProps) {
  const { report, setError, onConvertToEntrega, onSubmitNonEntrega } = props;
  const [localPending, setLocalPending] = useState<'yes' | 'no' | null>(null);

  const isClosedShop = report.type === 'tienda_cerrada';
  const yesLabel = isClosedShop ? 'Sí, abrieron' : 'Sí, ya funciona';
  const noLabel = isClosedShop ? 'No, sigue cerrada' : 'No, sigue sin funcionar';

  function handleYes() {
    setError(null);
    setLocalPending('yes');
    onConvertToEntrega();
  }

  function handleNo() {
    setError(null);
    setLocalPending('no');
    onSubmitNonEntrega('sin_entrega');
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
          isLoading={localPending === 'yes'}
          disabled={localPending !== null}
          className="w-full"
        >
          {yesLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={handleNo}
          isLoading={localPending === 'no'}
          disabled={localPending !== null}
          className="w-full"
        >
          {noLabel}
        </Button>
      </div>
    </section>
  );
}
