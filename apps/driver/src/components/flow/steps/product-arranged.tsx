'use client';

// Step — Foto del mueble una vez acomodado el producto.
// ADR-127 (2026-05-17): basta UNA foto para avanzar. La segunda es opcional.
// Mismo criterio que arrival-exhibit — los choferes pierden ~30s extra por
// parada cuando se les pide 2 fotos a fuerzas.

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ProductArrangedStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf } = props;
  const [savedKeys, setSavedKeys] = useState<Set<string>>(
    () => new Set(Object.keys(report.evidence)),
  );

  // ADR-127: ready con UNA foto. La segunda queda como opt-in.
  const ready = savedKeys.has('product_arranged');

  return (
    <StepShell
      title="Producto acomodado"
      description="Sube una foto del mueble con el producto acomodado. Puedes agregar otra si quieres documentar más detalle."
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
          label="Foto del producto acomodado"
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
          label="Foto adicional (opcional)"
          onQueued={() => setSavedKeys((s) => new Set(s).add('product_arranged_2'))}
        />
      </div>
    </StepShell>
  );
}
