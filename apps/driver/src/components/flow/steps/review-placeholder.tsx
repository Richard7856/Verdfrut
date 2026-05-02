'use client';

// Placeholder para los steps de revisión IA (waste_ticket_review, receipt_review).
// V1: el chofer confirma manualmente "todo bien" o "hay error". La extracción de
// datos via Claude Vision se agrega en el siguiente sprint (OCR de tickets).

import { Card } from '@verdfrut/ui';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

interface Props extends StepProps {
  kind: 'waste' | 'receipt';
}

export function ReviewPlaceholderStep(props: Props) {
  const { kind, pending, error, advanceTo, nextOf } = props;
  const label = kind === 'waste' ? 'merma' : 'recibo';
  return (
    <StepShell
      title={`Revisión del ${label}`}
      description="Foto cargada correctamente. La extracción automática de datos llega en el siguiente sprint."
      onContinue={() => advanceTo(nextOf({}))}
      pending={pending}
      error={error}
      continueLabel="Confirmar y continuar"
    >
      <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
        <p className="text-sm text-[var(--color-text)]">
          🚧 Pendiente: extraer número, fecha y total del ticket con Claude Vision.
        </p>
      </Card>
    </StepShell>
  );
}
