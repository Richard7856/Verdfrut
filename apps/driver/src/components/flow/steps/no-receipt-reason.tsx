'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

const MIN_LEN = 10;

export function NoReceiptReasonStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onPatch } = props;
  const [reason, setReason] = useState(report.noTicketReason ?? '');
  const [hasPhoto, setHasPhoto] = useState(Boolean(report.noTicketReasonPhotoUrl));
  const ready = reason.trim().length >= MIN_LEN;

  return (
    <StepShell
      title="¿Por qué no hay recibo?"
      description="Describe el motivo. Foto opcional si tienes evidencia del problema."
      onContinue={async () => {
        if (!ready) return;
        // Solo persistimos el texto en patch; la foto (si la hay) viaja por su
        // propia operación del outbox que ya se encargará de la columna.
        await onPatch({
          noTicketReason: reason.trim(),
        });
        advanceTo(nextOf({}));
      }}
      continueDisabled={!ready}
      pending={pending}
      error={error}
    >
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Ej. La tienda no quiso firmar; el encargado no estaba; etc."
        className="min-h-[120px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--vf-surface-1)] p-3 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] focus:border-[var(--vf-green-500)] focus:outline-none"
      />
      <p className="text-xs text-[var(--color-text-muted)]">
        {reason.trim().length < MIN_LEN
          ? `Mínimo ${MIN_LEN} caracteres (${reason.trim().length}/${MIN_LEN})`
          : '✓ Motivo válido'}
      </p>

      <p className="mt-2 text-xs font-medium text-[var(--color-text)]">Foto (opcional)</p>
      <PhotoInput
        bucket="evidence"
        routeId={route.id}
        stopId={report.stopId}
        reportId={report.id}
        slot="no_ticket_reason_photo"
        userId={userId}
        existingUrl={report.noTicketReasonPhotoUrl}
        label="Tomar foto"
        patchColumn="noTicketReasonPhotoUrl"
        onQueued={() => setHasPhoto(true)}
      />
      {hasPhoto && (
        <p className="text-xs text-[var(--color-text-muted)]">Foto agregada.</p>
      )}
    </StepShell>
  );
}
