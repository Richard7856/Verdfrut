'use client';

// Step `facade` — flujo `tienda_cerrada`.
// El chofer toma una foto de la fachada como evidencia de que llegó y la tienda
// estaba cerrada. Esa foto se reutiliza como `arrival_exhibit` si después la
// tienda se abre y el report se convierte a entrega.

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function FacadeStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onSaveEvidence } = props;
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.evidence['facade']));

  return (
    <StepShell
      title="Foto de la fachada"
      description="Toma una foto que muestre claramente que la tienda está cerrada (cortina, candado, letrero)."
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
        slot="facade"
        userId={userId}
        existingUrl={report.evidence['facade'] ?? null}
        label="Tomar foto de fachada"
        onUploaded={async (url) => {
          await onSaveEvidence('facade', url);
          setHasPhoto(true);
        }}
      />
    </StepShell>
  );
}
