'use client';

import { useState } from 'react';
import { StepShell } from '../step-shell';
import { PhotoInput } from '../photo-input';
import type { StepProps } from '../stop-detail-client';

const MIN_LEN = 10;

export function NoReceiptReasonStep(props: StepProps) {
  const { report, route, userId, pending, error, advanceTo, nextOf, onPatch, onSaveEvidence } =
    props;
  const [reason, setReason] = useState(report.noTicketReason ?? '');
  const [photoUrl, setPhotoUrl] = useState<string | null>(report.noTicketReasonPhotoUrl);
  const ready = reason.trim().length >= MIN_LEN;

  return (
    <StepShell
      title="¿Por qué no hay recibo?"
      description="Describe el motivo. Foto opcional si tienes evidencia del problema."
      onContinue={async () => {
        if (!ready) return;
        await onPatch({
          noTicketReason: reason.trim(),
          noTicketReasonPhotoUrl: photoUrl,
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
        slot="no_ticket_reason_photo"
        userId={userId}
        existingUrl={photoUrl}
        label="Tomar foto"
        onUploaded={async (url) => {
          await onSaveEvidence('no_ticket_reason_photo', url);
          setPhotoUrl(url);
        }}
      />
    </StepShell>
  );
}
