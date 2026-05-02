'use client';

import { useState } from 'react';
import { YesNoQuestion } from './yes-no-question';
import type { StepProps } from '../stop-detail-client';

export function WasteCheckStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf, onPatch, setError } = props;
  const [localPending, setLocalPending] = useState(false);

  async function answer(hasMerma: boolean) {
    setLocalPending(true);
    try {
      await onPatch({ hasMerma });
      advanceTo(nextOf({ hasMerma }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error');
    } finally {
      setLocalPending(false);
    }
  }

  return (
    <YesNoQuestion
      title="¿Hubo merma?"
      description="Producto que no se entregó por daño, caducidad o cualquier motivo."
      yesLabel="Sí, hay merma"
      noLabel="No"
      onYes={() => answer(true)}
      onNo={() => answer(false)}
      pending={pending || localPending}
      error={error}
    />
  );
}
