'use client';

// Step `scale` — flujo `bascula` (báscula no funciona).
// El chofer toma foto de la báscula o del problema (display apagado, error
// visible, etc.) como evidencia para el comercial.

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ScaleStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onSaveEvidence } = props;
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.evidence['scale']));

  return (
    <StepShell
      title="Foto del problema con la báscula"
      description="Captura el display, el error visible o lo que muestre que la báscula no opera."
      onContinue={() => advanceTo(nextOf({}))}
      continueDisabled={!hasPhoto}
      pending={pending}
      error={error}
      continueLabel="Avisar al comercial"
    >
      <PhotoInput
        bucket="evidence"
        routeId={route.id}
        stopId={report.stopId}
        slot="scale"
        userId={userId}
        existingUrl={report.evidence['scale'] ?? null}
        label="Tomar foto de báscula"
        onUploaded={async (url) => {
          await onSaveEvidence('scale', url);
          setHasPhoto(true);
        }}
      />
    </StepShell>
  );
}
