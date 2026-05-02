'use client';

// Step que en el flujo final abrirá el "carrito de incidencias" (selector de productos
// con tipo de incidencia, cantidad, etc.) y redirige al chat con el encargado.
//
// V1: stub funcional — agrega un placeholder de incidencia y avanza. La UI completa
// del cart vive en KNOWN_ISSUES como pendiente para el sprint de OCR/inventory.

import { Card } from '@verdfrut/ui';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

export function IncidentCartStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf, onPatch } = props;
  return (
    <StepShell
      title="Reportar incidencia"
      description="En esta versión, el encargado revisa el detalle por chat. La UI completa del carrito de incidencias llega en el siguiente sprint."
      onContinue={async () => {
        // Marcamos un placeholder en incident_details para que el report
        // tenga al menos rastro de que el chofer reportó incidencia.
        await onPatch({
          incidentDetails: [
            {
              productName: 'Pendiente de detallar via chat',
              type: 'rechazo',
              quantity: 0,
              unit: 'pcs',
              notes: 'Chofer reportó incidencia genérica desde la app — detallar con encargado.',
            },
          ],
        });
        advanceTo(nextOf({ hasIncidents: true }));
      }}
      pending={pending}
      error={error}
      continueLabel="Continuar al siguiente paso"
    >
      <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
        <p className="text-sm text-[var(--color-text)]">
          🚧 Pendiente: agregar productos uno a uno y abrir chat con tu encargado.
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Por ahora se registra que hubo incidencia y continuamos. Detalla los productos
          afectados directamente con tu encargado de zona después de finalizar la entrega.
        </p>
      </Card>
    </StepShell>
  );
}
