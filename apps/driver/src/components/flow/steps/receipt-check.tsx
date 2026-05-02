'use client';

import { YesNoQuestion } from './yes-no-question';
import type { StepProps } from '../stop-detail-client';

export function ReceiptCheckStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf } = props;
  return (
    <YesNoQuestion
      title="¿Tienes el recibo de la entrega?"
      description="El recibo o ticket que la tienda firmó/selló."
      yesLabel="Sí, tomar foto"
      noLabel="No tengo recibo"
      onYes={() => advanceTo(nextOf({ hasReceipt: true }))}
      onNo={() => advanceTo(nextOf({ hasReceipt: false }))}
      pending={pending}
      error={error}
    />
  );
}
