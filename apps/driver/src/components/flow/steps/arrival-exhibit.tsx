'use client';

// Step 1 — Foto del mueble/exhibidor a la llegada.
// Pide DOS fotos (vista frontal y lateral/general) — convención del prototipo Verdefrut.

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

export function ArrivalExhibitStep(props: StepProps) {
  const { report, route, store, userId, pending, error, advanceTo, nextOf } = props;
  // savedKeys mantiene qué slots fueron tomados en esta sesión, sin importar si
  // el upload terminó. La cola garantiza upload eventual (ADR-019).
  const [savedKeys, setSavedKeys] = useState<Set<string>>(
    () => new Set(Object.keys(report.evidence)),
  );

  const ready = savedKeys.has('arrival_exhibit') && savedKeys.has('arrival_exhibit_2');

  return (
    <StepShell
      title="Foto del exhibidor"
      description="Sube dos fotos del mueble como lo encontraste al llegar (frontal + general)."
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
          slot="arrival_exhibit"
          userId={userId}
          existingUrl={report.evidence['arrival_exhibit'] ?? null}
          label="Foto frontal"
          onQueued={() => setSavedKeys((s) => new Set(s).add('arrival_exhibit'))}
        />
        <PhotoInput
          bucket="evidence"
          routeId={route.id}
          stopId={report.stopId}
          reportId={report.id}
          slot="arrival_exhibit_2"
          userId={userId}
          existingUrl={report.evidence['arrival_exhibit_2'] ?? null}
          label="Foto general"
          onQueued={() => setSavedKeys((s) => new Set(s).add('arrival_exhibit_2'))}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Tienda: <strong>{store.name}</strong>
      </p>
    </StepShell>
  );
}
