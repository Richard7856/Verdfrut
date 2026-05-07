'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ReceiptUploadStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf } = props;
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.evidence['ticket_recibido']));

  return (
    <StepShell
      title="Foto del recibo"
      description="Toma una foto del recibo o ticket firmado/sellado por la tienda."
      onContinue={() => advanceTo(nextOf({}))}
      continueDisabled={!hasPhoto}
      pending={pending}
      error={error}
    >
      <PhotoInput
        bucket="ticket-images"
        routeId={route.id}
        stopId={report.stopId}
        reportId={report.id}
        slot="ticket_recibido"
        userId={userId}
        existingUrl={report.evidence['ticket_recibido'] ?? null}
        // patchColumn=ticketImageUrl → outbox encadena patch_report a la columna
        // dedicada cuando el upload termina (para queries del encargado).
        patchColumn="ticketImageUrl"
        onQueued={() => setHasPhoto(true)}
      />
    </StepShell>
  );
}
