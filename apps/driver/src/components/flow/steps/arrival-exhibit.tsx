'use client';

// Step 1 — Foto del mueble/exhibidor a la llegada.
// ADR-127 (2026-05-17): basta UNA foto del exhibidor para avanzar. La segunda
// es opcional (algunos clientes la quieren — la dejamos pero no bloquea).
// Antes pedía 2 obligatorias y eso retrasaba al chofer en cada parada.

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

  // ADR-127: ready con UNA foto. La segunda queda como opt-in opcional.
  const ready = savedKeys.has('arrival_exhibit');

  return (
    <StepShell
      title="Foto del exhibidor"
      description="Sube una foto del mueble como lo encontraste al llegar. Puedes agregar una segunda si quieres documentar otro ángulo."
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
          label="Foto del exhibidor"
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
          label="Foto adicional (opcional)"
          onQueued={() => setSavedKeys((s) => new Set(s).add('arrival_exhibit_2'))}
        />
      </div>
      <p className="text-xs text-[var(--color-text-muted)]">
        Tienda: <strong>{store.name}</strong>
      </p>
    </StepShell>
  );
}
