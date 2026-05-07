'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

const MIN_LEN = 10;

export function OtherIncidentStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onPatch } = props;
  const [desc, setDesc] = useState(report.otherIncidentDescription ?? '');
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.otherIncidentPhotoUrl));
  const ready = desc.trim().length >= MIN_LEN;

  return (
    <StepShell
      title="Describe la incidencia"
      description="Cualquier detalle adicional que el encargado deba saber. Foto opcional."
      onContinue={async () => {
        if (!ready) return;
        // Solo el texto va por patch; la foto la persiste el outbox vía patchColumn.
        await onPatch({
          otherIncidentDescription: desc.trim(),
        });
        advanceTo(nextOf({}));
      }}
      continueDisabled={!ready}
      pending={pending}
      error={error}
    >
      <textarea
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Ej. Problema con caja receptora; refrigeración deficiente; etc."
        className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none"
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        {desc.trim().length < MIN_LEN
          ? `Mínimo ${MIN_LEN} caracteres (${desc.trim().length}/${MIN_LEN})`
          : '✓ Descripción válida'}
      </p>

      <p className="mt-2 text-xs font-medium text-[var(--color-text)]">Foto (opcional)</p>
      <PhotoInput
        bucket="evidence"
        routeId={route.id}
        stopId={report.stopId}
        reportId={report.id}
        slot="other_incident_photo"
        userId={userId}
        existingUrl={report.otherIncidentPhotoUrl}
        label="Tomar foto"
        patchColumn="otherIncidentPhotoUrl"
        onQueued={() => setHasPhoto(true)}
      />
      {hasPhoto && (
        <p className="text-xs text-[var(--color-text-muted)]">Foto agregada.</p>
      )}
    </StepShell>
  );
}
