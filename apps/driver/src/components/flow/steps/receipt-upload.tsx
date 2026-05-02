'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ReceiptUploadStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onSaveEvidence, onPatch } =
    props;
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
        slot="ticket_recibido"
        userId={userId}
        existingUrl={report.evidence['ticket_recibido'] ?? null}
        onUploaded={async (url) => {
          await onSaveEvidence('ticket_recibido', url);
          // También persistimos en columna dedicada para queries fáciles del encargado.
          await onPatch({ ticketImageUrl: url });
          setHasPhoto(true);
        }}
      />
    </StepShell>
  );
}
