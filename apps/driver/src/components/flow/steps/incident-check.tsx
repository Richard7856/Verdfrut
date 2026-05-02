'use client';

import { YesNoQuestion } from './yes-no-question';
import type { StepProps } from '../stop-detail-client';

export function IncidentCheckStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf } = props;
  return (
    <YesNoQuestion
      title="¿Hubo alguna incidencia con el producto?"
      description="Producto rechazado, faltante, sobrante o devolución."
      yesLabel="Sí, reportar incidencia"
      noLabel="No, todo bien"
      onYes={() => advanceTo(nextOf({ hasIncidents: true }))}
      onNo={() => advanceTo(nextOf({ hasIncidents: false }))}
      pending={pending}
      error={error}
    />
  );
}
