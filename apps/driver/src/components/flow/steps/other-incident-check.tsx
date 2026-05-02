'use client';

import { YesNoQuestion } from './yes-no-question';
import type { StepProps } from '../stop-detail-client';

export function OtherIncidentCheckStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf } = props;
  return (
    <YesNoQuestion
      title="¿Otra incidencia para reportar?"
      description="Cualquier observación adicional que no entró en los pasos anteriores."
      yesLabel="Sí, agregar nota"
      noLabel="No, terminar"
      onYes={() => advanceTo(nextOf({ hasOtherIncident: true }))}
      onNo={() => advanceTo(nextOf({ hasOtherIncident: false }))}
      pending={pending}
      error={error}
    />
  );
}
