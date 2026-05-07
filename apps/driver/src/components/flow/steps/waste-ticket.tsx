'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function WasteTicketStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf } = props;
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.evidence['ticket_merma']));

  return (
    <StepShell
      title="Foto del ticket de merma"
      description="Toma una foto del ticket que recibiste de la tienda por la merma."
      onContinue={() => advanceTo(nextOf({}))}
      continueDisabled={!hasPhoto}
      pending={pending}
      error={error}
      continueLabel="Continuar"
    >
      <PhotoInput
        bucket="ticket-images"
        routeId={route.id}
        stopId={report.stopId}
        reportId={report.id}
        slot="ticket_merma"
        userId={userId}
        existingUrl={report.evidence['ticket_merma'] ?? null}
        onQueued={() => setHasPhoto(true)}
      />
    </StepShell>
  );
}
