'use client';

// Step `chat_redirect` — STUB temporal hasta Sprint 9.
// En el flujo real (cerrada/báscula), este step abre el chat con el comercial
// para que decida qué hacer. Mientras el chat realtime se construye,
// el chofer simula la espera con un botón.
//
// Una vez se implemente el chat (Sprint 9), este componente se reemplaza por
// un Link a `/route/stop/[id]/chat`.

import { Card } from '@verdfrut/ui';
import { StepShell } from '../step-shell';
import type { StepProps } from '../stop-detail-client';

export function ChatRedirectStep(props: StepProps) {
  const { pending, error, advanceTo, nextOf } = props;
  return (
    <StepShell
      title="Avisa al comercial"
      description="Llama o escribe a tu encargado para que confirme qué hacer. Cuando tengas respuesta, continúa."
      onContinue={() => advanceTo(nextOf({}))}
      pending={pending}
      error={error}
      continueLabel="Ya hablé con el comercial"
    >
      <Card className="border-[var(--color-border)] bg-[var(--vf-surface-2)]">
        <p className="text-sm text-[var(--color-text)]">
          🚧 El chat dentro de la app llega en el siguiente sprint.
        </p>
        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
          Por ahora, comunícate por WhatsApp o llamada con tu comercial. Espera ~20 min;
          si no responde, puedes continuar tu jornada.
        </p>
      </Card>
    </StepShell>
  );
}
