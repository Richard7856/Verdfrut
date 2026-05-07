'use client';

// Step — Foto del mueble una vez acomodado el producto. DOS fotos.

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ProductArrangedStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf } = props;
  const [savedKeys, setSavedKeys] = useState<Set<string>>(
    () => new Set(Object.keys(report.evidence)),
  );

  const ready = savedKeys.has('product_arranged') && savedKeys.has('product_arranged_2');

  return (
    <StepShell
      title="Producto acomodado"
      description="Sube dos fotos del mueble después de acomodar el producto."
      onContinue={() => advanceTo(nextOf({}))}
      continueDisabled={!ready}
      pending={pending}
      error={error}
    >
      <div className="grid grid-cols-1 gap-3">
        <PhotoInput
          bucket="evidence"
          routeId={route.id}
          stopId={report.stopId}
          reportId={report.id}
          slot="product_arranged"
          userId={userId}
          existingUrl={report.evidence['product_arranged'] ?? null}
          label="Foto frontal"
          onQueued={() => setSavedKeys((s) => new Set(s).add('product_arranged'))}
        />
        <PhotoInput
          bucket="evidence"
          routeId={route.id}
          stopId={report.stopId}
          reportId={report.id}
          slot="product_arranged_2"
          userId={userId}
          existingUrl={report.evidence['product_arranged_2'] ?? null}
          label="Foto general"
          onQueued={() => setSavedKeys((s) => new Set(s).add('product_arranged_2'))}
        />
      </div>
    </StepShell>
  );
}
